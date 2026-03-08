import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { googleFontCatalog } from './generated/font-catalog.js'
import {
    googleFontFamilies,
    isGoogleFontFamily,
    toFamilyName,
    type GoogleFontFamily,
    type GoogleFontsPluginOptions,
} from './types.js'
import {
    buildGoogleFontsUrl,
    fetchAvailableStaticWeightsCSS,
    fetchGoogleFontCSS,
    extractFontFileUrls,
    downloadFontFile,
} from './fetch.js'

export const DEFAULT_CACHE_DIR = 'node_modules/.google-fonts'
export const DEFAULT_FONT_BASE_DIR = 'fonts'

interface ResolvedFamily {
    family: GoogleFontFamily
    /** The canonical Google Fonts family name (e.g. 'JetBrains Mono'). */
    familyName: string
    slug: string
    weights: string[]
    hasExplicitWeights: boolean
    styles: string[]
    subsets: string[]
    display: string
    variable?: string
    fallback: string
}

interface RuntimeFontFamilyOptions {
    variable?: string
    weights?: number[] | 'variable'
    styles?: string[]
    subsets?: string[]
    display?: string
    fallback?: string
}

const CATEGORY_FALLBACKS: Record<string, string> = {
    'sans-serif': 'system-ui, sans-serif',
    serif: 'ui-serif, serif',
    monospace: 'ui-monospace, monospace',
}

export function getDefaultFallbackForFamily(family: GoogleFontFamily): string {
    return CATEGORY_FALLBACKS[googleFontCatalog[family].category] ?? 'sans-serif'
}

export interface DownloadedFamily {
    /** The canonical Google Fonts family name (e.g. 'JetBrains Mono'). */
    family: string
    slug: string
    /** The rewritten CSS with local file paths */
    css: string
    /** User-specified CSS variable name, e.g. '--font-sans' */
    variable?: string
    /** Fallback font stack */
    fallback: string
    /** Files written to cache */
    files: Array<{
        localPath: string
        fileName: string
        subset: string
    }>
}

/**
 * Convert a font family name to a URL/CSS-friendly slug.
 * 'Roboto Mono' -> 'roboto-mono'
 */
export function toSlug(family: string): string {
    return family
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
}

export function resolveFontBaseDir(base?: string): string {
    const normalized = (base ?? DEFAULT_FONT_BASE_DIR)
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '')

    if (!normalized || normalized === '.') {
        return DEFAULT_FONT_BASE_DIR
    }

    const segments = normalized.split('/')
    if (segments.some((segment) => segment === '' || segment === '..')) {
        throw new Error(`Invalid font base directory: ${base}`)
    }

    return normalized
}

// Short content hash for file names
function contentHash(content: Buffer): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 8)
}

const VARIABLE_WEIGHT_RANGES = [
    '100..900',
    '200..900',
    '300..900',
    '400..900',
    '100..800',
    '200..800',
    '300..700',
]

function extractWeightRangesFromError(message: string): string[] {
    const matches = message.match(/\b\d+\.\.\d+\b/g) ?? []
    const unique = new Set<string>()

    for (const range of matches) {
        unique.add(range)
    }

    return [...unique]
}

async function fetchVariableCSSWithRangeFallback(
    family: string,
    opts: {
        styles: string[]
        display: string
    },
): Promise<string> {
    let lastError: Error | undefined
    const queue = [...VARIABLE_WEIGHT_RANGES]
    const tried = new Set<string>()

    while (queue.length > 0) {
        const weightRange = queue.shift()!
        if (tried.has(weightRange)) continue
        tried.add(weightRange)

        try {
            const url = buildGoogleFontsUrl(family, {
                ...opts,
                weights: ['variable'],
                weightRange,
            })
            return await fetchGoogleFontCSS(url)
        } catch (err) {
            lastError = err as Error

            const discoveredRanges = extractWeightRangesFromError(lastError.message)
            for (const discoveredRange of discoveredRanges) {
                if (!tried.has(discoveredRange)) {
                    queue.unshift(discoveredRange)
                }
            }
        }
    }

    throw lastError ?? new Error(`No variable weight range available for ${family}`)
}

function extractReferencedLocalFiles(css: string): string[] {
    const fileNames = new Set<string>()
    const regex = /__FONT_BASE__([^)'"\s;]+)/g
    let match: RegExpExecArray | null

    while ((match = regex.exec(css)) !== null) {
        fileNames.add(match[1])
    }

    return [...fileNames]
}

function hasAllCachedFiles(fontsDir: string, files: string[]): boolean {
    return files.every((file) => fs.existsSync(path.join(fontsDir, file)))
}

function pruneFamilyCacheFiles(
    fontsDir: string,
    slug: string,
    keepFiles: string[],
): void {
    const keep = new Set(keepFiles)
    let entries: string[] = []

    try {
        entries = fs.readdirSync(fontsDir)
    } catch {
        return
    }

    for (const entry of entries) {
        if (!entry.startsWith(`${slug}-`) || keep.has(entry)) {
            continue
        }

        try {
            fs.unlinkSync(path.join(fontsDir, entry))
        } catch {
            // Best-effort cleanup only.
        }
    }
}

function normalizeFamilyNameForLookup(family: string): string {
    return family.trim().replace(/[ _]+/g, ' ').toLowerCase()
}

function levenshteinDistance(a: string, b: string): number {
    if (a === b) {
        return 0
    }

    const previous = Array.from({ length: b.length + 1 }, (_, index) => index)

    for (let i = 1; i <= a.length; i++) {
        let diagonal = previous[0]
        previous[0] = i

        for (let j = 1; j <= b.length; j++) {
            const temp = previous[j]
            previous[j] = Math.min(
                previous[j] + 1,
                previous[j - 1] + 1,
                diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
            )
            diagonal = temp
        }
    }

    return previous[b.length]
}

function findSuggestedFamilyName(family: string): GoogleFontFamily | undefined {
    const normalized = normalizeFamilyNameForLookup(family)

    for (const candidate of googleFontFamilies) {
        if (normalizeFamilyNameForLookup(candidate) === normalized) {
            return candidate
        }
    }

    let bestCandidate: GoogleFontFamily | undefined
    let bestDistance = Number.POSITIVE_INFINITY

    for (const candidate of googleFontFamilies) {
        const distance = levenshteinDistance(
            normalized,
            normalizeFamilyNameForLookup(candidate),
        )

        if (distance < bestDistance) {
            bestDistance = distance
            bestCandidate = candidate
        }
    }

    const threshold = Math.max(2, Math.floor(normalized.length * 0.3))
    return bestDistance <= threshold ? bestCandidate : undefined
}

function formatAllowedValues(values: readonly string[] | readonly number[]): string {
    return values.map(String).join(', ')
}

function assertArrayOption(
    family: string,
    optionName: string,
    value: unknown,
): asserts value is unknown[] {
    if (!Array.isArray(value)) {
        throw new Error(`Font family "${family}" expects "${optionName}" to be an array.`)
    }
}

export function validateGoogleFontsOptions(options: GoogleFontsPluginOptions): void {
    for (const [familyName, familyOptions] of Object.entries(options.fonts)) {
        if (!isGoogleFontFamily(familyName)) {
            const suggestion = findSuggestedFamilyName(familyName)
            const suggestionMessage = suggestion
                ? ` Did you mean "${suggestion}"?`
                : ''

            throw new Error(
                `Unknown Google font family "${familyName}".${suggestionMessage}`,
            )
        }

        const family = familyName as GoogleFontFamily
        const metadata: {
            weights: readonly number[]
            styles: readonly string[]
            subsets: readonly string[]
            category: string
            variable: boolean
        } = googleFontCatalog[family]
        const config: RuntimeFontFamilyOptions = familyOptions ?? {}

        if (
            config.variable !== undefined &&
            !config.variable.startsWith('--')
        ) {
            throw new Error(
                `Font family "${family}" expects "variable" to start with "--".`,
            )
        }

        if (config.styles !== undefined) {
            assertArrayOption(family, 'styles', config.styles)

            for (const style of config.styles) {
                if (!metadata.styles.includes(String(style))) {
                    throw new Error(
                        `Font family "${family}" does not support style "${String(style)}". Supported styles: ${formatAllowedValues(metadata.styles)}.`,
                    )
                }
            }
        }

        if (config.subsets !== undefined) {
            assertArrayOption(family, 'subsets', config.subsets)

            for (const subset of config.subsets) {
                if (!metadata.subsets.includes(String(subset))) {
                    throw new Error(
                        `Font family "${family}" does not support subset "${String(subset)}". Supported subsets: ${formatAllowedValues(metadata.subsets)}.`,
                    )
                }
            }
        }

        if (config.weights === undefined) {
            continue
        }

        if (options.optimizeWeights !== false) {
            throw new Error(
                `Font family "${family}" cannot specify "weights" unless "optimizeWeights" is set to false.`,
            )
        }

        if (config.weights === 'variable') {
            if (!metadata.variable) {
                throw new Error(
                    `Font family "${family}" does not support variable weights.`,
                )
            }

            continue
        }

        assertArrayOption(family, 'weights', config.weights)

        for (const weight of config.weights) {
            if (
                typeof weight !== 'number' ||
                !metadata.weights.includes(weight)
            ) {
                throw new Error(
                    `Font family "${family}" does not support weight "${String(weight)}". Supported weights: ${formatAllowedValues(metadata.weights)}.`,
                )
            }
        }
    }
}

function resolveFamily(
    family: GoogleFontFamily,
    config?: RuntimeFontFamilyOptions,
): ResolvedFamily {
    const defaults: Required<Pick<RuntimeFontFamilyOptions, 'styles' | 'subsets' | 'display'>> = {
        styles: ['normal'],
        subsets: ['latin'],
        display: 'swap',
    }

    const opts = { ...defaults, ...config }
    const hasExplicitWeights = opts.weights !== undefined

    const weights =
        !hasExplicitWeights
            ? []
            : opts.weights === 'variable'
                ? ['variable']
                : (opts.weights ?? [400]).map(String)

    const familyName = toFamilyName(family)

    return {
        family,
        familyName,
        slug: toSlug(familyName),
        weights,
        hasExplicitWeights,
        styles: opts.styles ?? ['normal'],
        subsets: opts.subsets ?? ['latin'],
        display: opts.display ?? 'swap',
        variable: opts.variable,
        fallback: opts.fallback ?? getDefaultFallbackForFamily(family),
    }
}

/**
 * Process all configured font families:
 * 1. Fetch CSS from Google Fonts
 * 2. Download font files
 * 3. Cache to disk
 * 4. Rewrite CSS with local paths
 */
export async function processAllFonts(
    options: GoogleFontsPluginOptions,
    root: string,
    log: (msg: string) => void,
    context?: {
        usedStaticWeights?: string[]
    },
): Promise<DownloadedFamily[]> {
    const cacheDir = path.resolve(root, options.cacheDir ?? DEFAULT_CACHE_DIR)
    const fontBaseDir = resolveFontBaseDir(options.base)
    const fontsDir = path.join(cacheDir, fontBaseDir)
    const metaFile = path.join(cacheDir, 'meta.json')

    // Ensure directories exist
    fs.mkdirSync(fontsDir, { recursive: true })

    // Load existing meta (for cache hit detection)
    let meta: Record<string, { hash: string; files: string[] }> = {}
    if (fs.existsSync(metaFile)) {
        try {
            meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'))
        } catch {
            meta = {}
        }
    }

    const families = Object.entries(options.fonts)
    const results: DownloadedFamily[] = []

    for (const [familyName, familyOptions] of families) {
        const resolved = resolveFamily(
            familyName as GoogleFontFamily,
            familyOptions as RuntimeFontFamilyOptions | undefined,
        )
        const optimizedStaticWeights = context?.usedStaticWeights

        // Build a hash of the config to detect changes
        const configHash = crypto
            .createHash('md5')
            .update(JSON.stringify({
                version: 5,
                resolved,
                optimizedStaticWeights,
            }))
            .digest('hex')

        // Check cache
        const cached = meta[resolved.slug]
        const cssFile = path.join(cacheDir, `${resolved.slug}.css`)

        if (cached?.hash === configHash && fs.existsSync(cssFile)) {
            const css = fs.readFileSync(cssFile, 'utf-8')
            const referencedFiles = extractReferencedLocalFiles(css)
            const filesToUse = referencedFiles.length > 0 ? referencedFiles : cached.files
            if (hasAllCachedFiles(fontsDir, filesToUse)) {
                results.push({
                    family: resolved.familyName,
                    slug: resolved.slug,
                    css,
                    variable: resolved.variable,
                    fallback: resolved.fallback,
                    files: filesToUse.map((f) => ({
                        localPath: path.join(fontsDir, f),
                        fileName: f,
                        subset: '',
                    })),
                })
                continue
            }

            log(`${resolved.familyName}: cache metadata was present but font files were missing, rebuilding cache`)
        }

        // Fetch CSS from Google Fonts
        let cssContent: string
        try {
            const baseBuildUrlOpts = {
                weights: resolved.weights,
                styles: resolved.styles,
                display: resolved.display,
            }

            if (resolved.hasExplicitWeights && resolved.weights.includes('variable')) {
                // User explicitly requested variable font — use range fallback so we discover the correct wght range.
                // If the font is not available as variable, all back to downloading all available static weights.
                try {
                    cssContent = await fetchVariableCSSWithRangeFallback(
                        resolved.familyName,
                        {
                            styles: resolved.styles,
                            display: resolved.display,
                        },
                    )
                } catch {
                    log(`${resolved.familyName} is not available as variable font, falling back to static weights`)
                    const staticResult = await fetchAvailableStaticWeightsCSS(
                        resolved.familyName,
                        {
                            styles: resolved.styles,
                            display: resolved.display,
                        },
                    )
                    cssContent = staticResult.css
                }
            } else if (resolved.hasExplicitWeights) {
                let weightsToUse = resolved.weights

                // For explicit numeric weights, merge with codebase-detected weights so that weights used in CSS (e.g. font-bold → 700) are also included.
                if (
                    optimizedStaticWeights &&
                    optimizedStaticWeights.length > 0
                ) {
                    const merged = new Set([...resolved.weights, ...optimizedStaticWeights])
                    weightsToUse = [...merged].sort((a, b) => Number(a) - Number(b))

                    const added = weightsToUse.filter((w) => !resolved.weights.includes(w))
                    if (added.length > 0) {
                        log(`${resolved.familyName}: added detected weights [${added.join(', ')}] to explicit [${resolved.weights.join(', ')}]`)
                    }
                }

                const url = buildGoogleFontsUrl(resolved.familyName, {
                    ...baseBuildUrlOpts,
                    weights: weightsToUse,
                })
                cssContent = await fetchGoogleFontCSS(url)
            } else {
                const variableOpts = {
                    ...baseBuildUrlOpts,
                    weights: ['variable'],
                }

                try {
                    cssContent = await fetchVariableCSSWithRangeFallback(
                        resolved.familyName,
                        variableOpts,
                    )
                } catch {
                    const staticBaseOpts = {
                        ...baseBuildUrlOpts,
                    }
                    let staticResult: { css: string; weights: string[] }

                    if (optimizedStaticWeights && optimizedStaticWeights.length > 0) {
                        try {
                            staticResult = await fetchAvailableStaticWeightsCSS(
                                resolved.familyName,
                                {
                                    ...staticBaseOpts,
                                    candidates: optimizedStaticWeights,
                                },
                            )
                        } catch {
                            staticResult = await fetchAvailableStaticWeightsCSS(
                                resolved.familyName,
                                staticBaseOpts,
                            )
                        }
                    } else {
                        staticResult = await fetchAvailableStaticWeightsCSS(
                            resolved.familyName,
                            staticBaseOpts,
                        )
                    }

                    cssContent = staticResult.css
                }
            }
        } catch (err) {
            log(`Failed to fetch ${familyName}: ${(err as Error).message}`)
            continue
        }

        const filteredCSS = filterCSSBySubsets(cssContent, resolved.subsets)

        // Extract font file URLs
        const fontFiles = extractFontFileUrls(filteredCSS)

        // Download each font file
        const downloadedFiles: Array<{
            originalUrl: string
            localPath: string
            fileName: string
            subset: string
        }> = []

        for (const fileInfo of fontFiles) {
            try {
                const buffer = await downloadFontFile(fileInfo.url)
                const hash = contentHash(buffer)
                const ext = path.extname(new URL(fileInfo.url).pathname) || '.woff2'
                const fileName = `${resolved.slug}-${fileInfo.subset}-${hash}${ext}`
                const localPath = path.join(fontsDir, fileName)

                fs.writeFileSync(localPath, buffer)

                downloadedFiles.push({
                    originalUrl: fileInfo.url,
                    localPath,
                    fileName,
                    subset: fileInfo.subset,
                })
            } catch (err) {
                log(`Failed to download font file: ${(err as Error).message}`)
            }
        }

        // Rewrite CSS: replace Google URLs with local paths
        let rewrittenCSS = filteredCSS

        for (const dl of downloadedFiles) {
            rewrittenCSS = rewrittenCSS.replaceAll(
                dl.originalUrl,
                `__FONT_BASE__${dl.fileName}`,
            )
        }

        // Write CSS to cache
        fs.writeFileSync(cssFile, rewrittenCSS)

        const referencedFiles = extractReferencedLocalFiles(rewrittenCSS)
        const referencedFileSet = new Set(referencedFiles)
        const emittedFiles = downloadedFiles.filter((f) => referencedFileSet.has(f.fileName))

        // Update meta
        meta[resolved.slug] = {
            hash: configHash,
            files: referencedFiles,
        }
        pruneFamilyCacheFiles(fontsDir, resolved.slug, referencedFiles)

        results.push({
            family: resolved.familyName,
            slug: resolved.slug,
            css: rewrittenCSS,
            variable: resolved.variable,
            fallback: resolved.fallback,
            files: emittedFiles.map((f) => ({
                localPath: f.localPath,
                fileName: f.fileName,
                subset: f.subset,
            })),
        })
    }

    // Save meta
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2))

    return results
}

// Filter CSS to only keep @font-face blocks that match the requested subsets. Google Fonts CSS has comments like `/* latin * /` before each @font-face block.
function filterCSSBySubsets(css: string, subsets: string[]): string {
    // Split at subset comment boundaries
    const blocks: string[] = []
    const parts = css.split(/\/\*\s*([a-z-]+)\s*\*\//)

    // parts is [beforeFirst, subset1, css1, subset2, css2, ...]
    if (parts.length <= 1) {
        // No subset comments found — return as-is
        return css
    }

    for (let i = 1; i < parts.length; i += 2) {
        const subset = parts[i].trim()
        const block = parts[i + 1]
        if (block && subsets.includes(subset)) {
            blocks.push(`/* ${subset} */\n${block}`)
        }
    }

    return blocks.length > 0 ? blocks.join('\n') : css
}

/**
 * Generate CSS custom properties and utility classes for all families.
 */
export function generateFontCSS(
    downloadedFamilies: DownloadedFamily[],
    fontBase: string,
): string {
    let css = '/* Generated by vite-plugin-google-fonts — do not edit */\n\n'

    // Add @font-face declarations
    for (const family of downloadedFamilies) {
        css += family.css.replaceAll('__FONT_BASE__', fontBase) + '\n\n'
    }

    // Collect all CSS variables that need to be set on :root
    const variables: Array<{ varName: string; value: string }> = []

    for (const family of downloadedFamilies) {
        const fontValue = `'${family.family}', ${family.fallback}`

        // If user specified a custom variable name, use that
        if (family.variable) {
            variables.push({ varName: family.variable, value: fontValue })
        }

        // Always also set --font-{slug} as the canonical variable
        variables.push({ varName: `--font-${family.slug}`, value: fontValue })
    }

    if (variables.length > 0) {
        css += ':root {\n'
        // Deduplicate (in case user variable equals the slug variable)
        const seen = new Set<string>()
        for (const { varName, value } of variables) {
            if (seen.has(varName)) continue
            seen.add(varName)
            css += `  ${varName}: ${value};\n`
        }
        css += '}\n\n'
    }

    return css
}

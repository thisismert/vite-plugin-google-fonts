import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { FontFamilyOptions, GoogleFontsPluginOptions } from './types.js'
import {
    buildGoogleFontsUrl,
    fetchAvailableStaticWeightsCSS,
    fetchGoogleFontCSS,
    extractFontFileUrls,
    downloadFontFile,
} from './fetch.js'

export const DEFAULT_CACHE_DIR = 'node_modules/.google-fonts'

interface ResolvedFamily {
    family: string
    slug: string
    weights: string[]
    hasExplicitWeights: boolean
    styles: string[]
    subsets: string[]
    display: string
    variable?: string
    fallback: string
}

export interface DownloadedFamily {
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

function normalizeFamilyName(family: string): string {
    return family.trim().replace(/[ _]+/g, ' ')
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

function resolveFamily(
    family: string,
    config?: FontFamilyOptions,
): ResolvedFamily {
    const defaults: FontFamilyOptions = {
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

    return {
        family: normalizeFamilyName(family),
        slug: toSlug(family),
        weights,
        hasExplicitWeights,
        styles: opts.styles ?? ['normal'],
        subsets: opts.subsets ?? ['latin'],
        display: opts.display ?? 'swap',
        variable: opts.variable,
        fallback: opts.fallback ?? 'sans-serif',
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
    const fontsDir = path.join(cacheDir, 'fonts')
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
        const resolved = resolveFamily(familyName, familyOptions)
        const optimizedStaticWeights = context?.usedStaticWeights

        // Build a hash of the config to detect changes
        const configHash = crypto
            .createHash('md5')
            .update(JSON.stringify({
                version: 4,
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

            results.push({
                family: resolved.family,
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
                        resolved.family,
                        {
                            styles: resolved.styles,
                            display: resolved.display,
                        },
                    )
                } catch {
                    log(`${resolved.family} is not available as variable font, falling back to static weights`)
                    const staticResult = await fetchAvailableStaticWeightsCSS(
                        resolved.family,
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
                        log(`${resolved.family}: added detected weights [${added.join(', ')}] to explicit [${resolved.weights.join(', ')}]`)
                    }
                }

                const url = buildGoogleFontsUrl(resolved.family, {
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
                        resolved.family,
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
                                resolved.family,
                                {
                                    ...staticBaseOpts,
                                    candidates: optimizedStaticWeights,
                                },
                            )
                        } catch {
                            staticResult = await fetchAvailableStaticWeightsCSS(
                                resolved.family,
                                staticBaseOpts,
                            )
                        }
                    } else {
                        staticResult = await fetchAvailableStaticWeightsCSS(
                            resolved.family,
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

        results.push({
            family: resolved.family,
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

    return blocks.join('\n')
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
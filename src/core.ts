import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { googleFontCatalog } from './generated/font-catalog.js'
import {
    isGoogleFontFamily,
    type GoogleFontFamily,
    type GoogleFontsPluginOptions,
} from './types.js'
import {
    buildGoogleFontsUrl,
    downloadFontFile,
    extractFontFileUrls,
    fetchGoogleFontCSS,
} from './fetch.js'

const CACHE_PATH = '.cache'
const FONT_PATH = 'fonts'

const CACHE_VERSION = 1
const FONT_DISPLAY_VALUES = new Set([
    'auto',
    'block',
    'swap',
    'fallback',
    'optional',
])
const CATEGORY_FALLBACKS: Record<string, string> = {
    'sans-serif': 'system-ui, sans-serif',
    serif: 'ui-serif, serif',
    monospace: 'ui-monospace, monospace',
}

interface RuntimeFontFamilyOptions {
    variable?: string
    weights?: readonly number[] | 'variable'
    styles?: readonly string[]
    subsets?: readonly string[]
    display?: string
    fallback?: string
}

interface FontMetadata {
    family: string
    weights: readonly number[]
    styles: readonly string[]
    subsets: readonly string[]
    category: string
    variable: boolean
}

interface ResolvedFamily {
    family: GoogleFontFamily
    familyName: string
    slug: string
    weights: readonly string[]
    weightRange?: string
    styles: readonly string[]
    subsets: readonly string[]
    display: string
    variable?: string
    fallback: string
}

export interface DownloadedFamily {
    family: string
    slug: string
    css: string
    variable?: string
    fallback: string
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function createLoggedError(
    log: (message: string) => void,
    message: string,
    cause: unknown,
): Error {
    log(message)
    return new Error(message, { cause })
}

function cleanupDownloadedFiles(filePaths: readonly string[]): void {
    for (const filePath of filePaths) {
        try {
            fs.unlinkSync(filePath)
        } catch {
            // Cleanup is best effort after a failed download.
        }
    }
}

function formatAllowedValues(values: readonly (string | number)[]): string {
    return values.map(String).join(', ')
}

function assertArrayOption(
    family: string,
    optionName: string,
    value: unknown,
): asserts value is unknown[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(
            `Font family "${family}" expects "${optionName}" to be a non-empty array.`,
        )
    }
}

function validateFamilyOptions(
    family: GoogleFontFamily,
    rawOptions: unknown,
    optimizeWeights: boolean,
): void {
    if (rawOptions === undefined) {
        return
    }

    if (
        typeof rawOptions !== 'object' ||
        rawOptions === null ||
        Array.isArray(rawOptions)
    ) {
        throw new Error(`Font family "${family}" expects an options object.`)
    }

    const config = rawOptions as RuntimeFontFamilyOptions
    const metadata = googleFontCatalog[family] as FontMetadata

    if (
        config.variable !== undefined &&
        (typeof config.variable !== 'string' ||
            !/^--[^\s;{}]+$/.test(config.variable))
    ) {
        throw new Error(
            `Font family "${family}" expects "variable" to be a valid CSS custom property name.`,
        )
    }

    if (
        config.display !== undefined &&
        (typeof config.display !== 'string' ||
            !FONT_DISPLAY_VALUES.has(config.display))
    ) {
        throw new Error(
            `Font family "${family}" expects "display" to be one of: ${formatAllowedValues([...FONT_DISPLAY_VALUES])}.`,
        )
    }

    if (
        config.fallback !== undefined &&
        (typeof config.fallback !== 'string' || !config.fallback.trim())
    ) {
        throw new Error(
            `Font family "${family}" expects "fallback" to be a non-empty string.`,
        )
    }

    if (config.styles !== undefined) {
        assertArrayOption(family, 'styles', config.styles)

        for (const style of config.styles) {
            if (
                typeof style !== 'string' ||
                !metadata.styles.includes(style)
            ) {
                throw new Error(
                    `Font family "${family}" does not support style "${String(style)}". Supported styles: ${formatAllowedValues(metadata.styles)}.`,
                )
            }
        }
    }

    if (config.subsets !== undefined) {
        assertArrayOption(family, 'subsets', config.subsets)

        for (const subset of config.subsets) {
            if (
                typeof subset !== 'string' ||
                !metadata.subsets.includes(subset)
            ) {
                throw new Error(
                    `Font family "${family}" does not support subset "${String(subset)}". Supported subsets: ${formatAllowedValues(metadata.subsets)}.`,
                )
            }
        }
    }

    if (config.weights === undefined) {
        return
    }

    if (!optimizeWeights) {
        if (config.weights === 'variable') {
            if (!metadata.variable) {
                throw new Error(
                    `Font family "${family}" does not support variable weights.`,
                )
            }
            return
        }

        assertArrayOption(family, 'weights', config.weights)

        for (const weight of config.weights) {
            if (
                typeof weight !== 'number' ||
                !Number.isInteger(weight) ||
                !metadata.weights.includes(weight)
            ) {
                throw new Error(
                    `Font family "${family}" does not support weight "${String(weight)}". Supported weights: ${formatAllowedValues(metadata.weights)}.`,
                )
            }
        }

        return
    }

    throw new Error(
        `Font family "${family}" cannot specify "weights" while "optimizeWeights" is enabled.`,
    )
}

export function validateGoogleFontsOptions(
    options: GoogleFontsPluginOptions,
): void {
    if (!options || typeof options !== 'object') {
        throw new Error('Google Fonts options must be an object.')
    }

    if (options.optimizeWeights !== undefined && options.optimizeWeights !== false && options.optimizeWeights !== true) {
        throw new Error('"optimizeWeights" must be a boolean.')
    }

    if (
        !options.fonts ||
        typeof options.fonts !== 'object' ||
        Array.isArray(options.fonts)
    ) {
        throw new Error('Google Fonts options must include a fonts object.')
    }

    const optimizeWeights = options.optimizeWeights !== false

    for (const [familyName, familyOptions] of Object.entries(options.fonts)) {
        if (!isGoogleFontFamily(familyName)) {
            throw new Error(`Unknown Google font family "${familyName}".`)
        }

        validateFamilyOptions(
            familyName,
            familyOptions,
            optimizeWeights,
        )
    }
}

function defaultStyle(family: GoogleFontFamily): string {
    const styles = (googleFontCatalog[family] as FontMetadata).styles
    return styles.includes('normal') ? 'normal' : styles[0]
}

function defaultSubset(family: GoogleFontFamily): string {
    const subsets = (googleFontCatalog[family] as FontMetadata).subsets
    return subsets.includes('latin') ? 'latin' : subsets[0]
}

function variableWeightRange(family: GoogleFontFamily): string {
    const weights = (googleFontCatalog[family] as FontMetadata).weights
    return `${Math.min(...weights)}..${Math.max(...weights)}`
}

function toSlug(family: string): string {
    return family
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
}

function contentHash(content: Buffer): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 8)
}

function resolveFamily(
    family: GoogleFontFamily,
    rawOptions: unknown,
    optimizeWeights: boolean,
    usedStaticWeights: readonly string[] | undefined,
): ResolvedFamily {
    const config = (rawOptions ?? {}) as RuntimeFontFamilyOptions
    const metadata = googleFontCatalog[family] as FontMetadata
    const familyName = metadata.family
    const explicitWeights = config.weights

    let weights: readonly string[]
    if (explicitWeights === 'variable') {
        weights = ['variable']
    } else if (explicitWeights) {
        weights = [...new Set(explicitWeights)].map(String)
    } else if (metadata.variable) {
        weights = ['variable']
    } else {
        const detectedWeights = optimizeWeights
            ? [
                ...new Set(
                    (usedStaticWeights ?? []).filter((weight) =>
                        metadata.weights.includes(Number(weight)),
                    ),
                ),
            ]
            : []

        weights = detectedWeights.length > 0
            ? detectedWeights
            : metadata.weights.map(String)
    }

    const styles = config.styles?.length
        ? [...config.styles]
        : [defaultStyle(family)]
    const subsets = config.subsets?.length
        ? [...config.subsets]
        : [defaultSubset(family)]

    return {
        family,
        familyName,
        slug: toSlug(familyName),
        weights,
        weightRange: weights.includes('variable')
            ? variableWeightRange(family)
            : undefined,
        styles,
        subsets,
        display: config.display ?? 'swap',
        variable: config.variable,
        fallback:
            config.fallback ??
            (CATEGORY_FALLBACKS[metadata.category] ?? 'sans-serif'),
    }
}

function extractReferencedLocalFiles(css: string): string[] {
    const fileNames = new Set<string>()
    const regex = /__FONT_PATH__([^)'"\s;]+)/g
    let match: RegExpExecArray | null

    while ((match = regex.exec(css)) !== null) {
        fileNames.add(match[1])
    }

    return [...fileNames]
}

function hasAllCachedFiles(fontsDir: string, files: readonly string[]): boolean {
    return files.every((file) => fs.existsSync(path.join(fontsDir, file)))
}

function pruneFamilyCacheFiles(
    fontsDir: string,
    familyFiles: readonly string[],
    keepFiles: readonly string[],
): void {
    const keep = new Set(keepFiles)

    for (const entry of new Set(familyFiles)) {
        if (keep.has(entry)) {
            continue
        }

        try {
            fs.unlinkSync(path.join(fontsDir, entry))
        } catch {
            // Stale cache cleanup is best effort.
        }
    }
}

function readCacheManifest(filePath: string): Record<string, string> {
    if (!fs.existsSync(filePath)) {
        return {}
    }

    try {
        const value: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return {}
        }

        return Object.fromEntries(
            Object.entries(value).filter(
                (entry): entry is [string, string] =>
                    typeof entry[1] === 'string',
            ),
        )
    } catch {
        return {}
    }
}

function createDownloadedFamily(
    resolved: ResolvedFamily,
    css: string,
): DownloadedFamily {
    return {
        family: resolved.familyName,
        slug: resolved.slug,
        css,
        variable: resolved.variable,
        fallback: resolved.fallback,
    }
}

export async function processAllFonts(
    options: GoogleFontsPluginOptions,
    packageRoot: string,
    log: (message: string) => void,
    context: { usedStaticWeights?: readonly string[] } = {},
): Promise<DownloadedFamily[]> {
    const cacheRoot = path.join(packageRoot, CACHE_PATH)
    const fontsDir = path.join(cacheRoot, FONT_PATH)
    const manifestFile = path.join(cacheRoot, 'meta.json')

    fs.mkdirSync(fontsDir, { recursive: true })

    const manifest = readCacheManifest(manifestFile)
    const optimizeWeights = options.optimizeWeights !== false
    const families = Object.entries(options.fonts) as Array<
        [string, RuntimeFontFamilyOptions | undefined]
    >
    const results: DownloadedFamily[] = []

    for (const [familyName, familyOptions] of families) {
        const family = familyName as GoogleFontFamily
        const resolved = resolveFamily(
            family,
            familyOptions,
            optimizeWeights,
            context.usedStaticWeights,
        )
        const configHash = crypto
            .createHash('sha256')
            .update(
                JSON.stringify({
                    cacheVersion: CACHE_VERSION,
                    resolved,
                }),
            )
            .digest('hex')
        const cssFile = path.join(cacheRoot, `${resolved.slug}.css`)
        const cachedHash = manifest[resolved.slug]

        if (cachedHash === configHash && fs.existsSync(cssFile)) {
            const css = fs.readFileSync(cssFile, 'utf8')
            const files = extractReferencedLocalFiles(css)

            if (hasAllCachedFiles(fontsDir, files)) {
                results.push(createDownloadedFamily(resolved, css))
                continue
            }

            log(
                `${resolved.familyName}: cached font files are missing; rebuilding the cache`,
            )
        }

        const previousFiles = fs.existsSync(cssFile)
            ? extractReferencedLocalFiles(fs.readFileSync(cssFile, 'utf8'))
            : []

        let cssContent: string
        try {
            const url = buildGoogleFontsUrl(resolved.familyName, {
                weights: resolved.weights,
                styles: resolved.styles,
                display: resolved.display,
                weightRange: resolved.weightRange,
            })
            cssContent = await fetchGoogleFontCSS(url)
        } catch (error) {
            throw createLoggedError(
                log,
                `Failed to fetch CSS for ${resolved.familyName}: ${errorMessage(error)}`,
                error,
            )
        }

        const filteredCSS = filterCSSBySubsets(cssContent, resolved.subsets)
        const fontFiles = extractFontFileUrls(filteredCSS)
        const downloadedFiles: Array<{
            originalUrl: string
            localPath: string
            fileName: string
        }> = []

        for (const fileInfo of fontFiles) {
            try {
                const buffer = await downloadFontFile(fileInfo.url)
                const hash = contentHash(buffer)
                const extension =
                    path.extname(new URL(fileInfo.url).pathname) || '.woff2'
                const fileName = `${resolved.slug}-${fileInfo.subset}-${hash}${extension}`
                const localPath = path.join(fontsDir, fileName)

                fs.writeFileSync(localPath, buffer)
                downloadedFiles.push({
                    originalUrl: fileInfo.url,
                    localPath,
                    fileName,
                })
            } catch (error) {
                cleanupDownloadedFiles(
                    downloadedFiles.map((file) => file.localPath),
                )
                throw createLoggedError(
                    log,
                    `Failed to download font file for ${resolved.familyName} (${fileInfo.subset || 'unknown subset'}): ${fileInfo.url} - ${errorMessage(error)}`,
                    error,
                )
            }
        }

        let rewrittenCSS = filteredCSS
        for (const file of downloadedFiles) {
            rewrittenCSS = rewrittenCSS.replaceAll(
                file.originalUrl,
                `__FONT_PATH__${file.fileName}`,
            )
        }

        fs.writeFileSync(cssFile, rewrittenCSS)

        const referencedFiles = extractReferencedLocalFiles(rewrittenCSS)
        manifest[resolved.slug] = configHash
        pruneFamilyCacheFiles(fontsDir, previousFiles, referencedFiles)

        results.push(
            createDownloadedFamily(resolved, rewrittenCSS),
        )
    }

    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
    return results
}

function filterCSSBySubsets(css: string, subsets: readonly string[]): string {
    const parts = css.split(/\/\*\s*([a-z-]+)\s*\*\//)
    if (parts.length <= 1) {
        return css
    }

    const blocks: string[] = []
    for (let index = 1; index < parts.length; index += 2) {
        const subset = parts[index].trim()
        const block = parts[index + 1]

        if (block && subsets.includes(subset)) {
            blocks.push(`/* ${subset} */\n${block}`)
        }
    }

    return blocks.length > 0 ? blocks.join('\n') : css
}

export function generateFontCSS(
    downloadedFamilies: readonly DownloadedFamily[],
    fontPath: string,
    includeTailwindTheme = false,
): string {
    const sections = [
        '/* Generated by vite-plugin-google-fonts — do not edit */',
        ...downloadedFamilies.map((family) =>
            family.css.replaceAll('__FONT_PATH__', fontPath),
        ),
    ]
    const variables = new Map<string, string>()
    const themeVariables = new Set<string>()

    for (const family of downloadedFamilies) {
        const value = `'${family.family}', ${family.fallback}`
        if (family.variable && !variables.has(family.variable)) {
            variables.set(family.variable, value)
        }
        if (family.variable) {
            themeVariables.add(family.variable)
        }

        const canonicalVariable = `--font-${family.slug}`
        if (!variables.has(canonicalVariable)) {
            variables.set(canonicalVariable, value)
        }
    }

    if (variables.size > 0) {
        const declarations = [...variables]
            .map(([name, value]) => `  ${name}: ${value};`)
            .join('\n')
        sections.push(`:root {\n${declarations}\n}`)

        if (includeTailwindTheme && themeVariables.size > 0) {
            const themeDeclarations = [...themeVariables]
                .map((name) => `  ${name}: var(${name});`)
                .join('\n')
            sections.push(`@theme inline {\n${themeDeclarations}\n}`)
        }
    }

    return `${sections.join('\n\n')}\n`
}

import fs from 'node:fs'
import path from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'
import type { FontMap, GoogleFontsPluginOptions } from './types.js'
import {
    processAllFonts,
    generateFontCSS,
    toSlug,
    DEFAULT_CACHE_DIR,
    type DownloadedFamily,
} from './core.js'

// File extensions to scan for used font weights when `optimizeWeights` is enabled.
const SCAN_EXTENSIONS = new Set([
    '.css',
    '.pcss',
    '.postcss',
    '.scss',
    '.sass',
    '.less',
    '.styl',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.html',
    '.vue',
    '.svelte',
    '.astro',
    '.mdx',
])

const IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    '.vite',
    '.turbo',
    '.next',
    '.nuxt',
    'coverage',
])

// Canonical weight name -> numeric value mapping.
const WEIGHT_NAME_TO_NUMERIC: Record<string, string> = {
    thin: '100',
    extralight: '200',
    light: '300',
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
    black: '900',
}

function normalizeWeightToken(token: string): string | null {
    const lower = token.toLowerCase()

    const named = WEIGHT_NAME_TO_NUMERIC[lower]
    if (named) return named

    const numeric = Number.parseInt(lower, 10)
    if (!Number.isFinite(numeric)) return null
    if (numeric < 100 || numeric > 900) return null
    if (numeric % 100 !== 0) return null

    return String(numeric)
}

function extractWeightsFromCSS(content: string): string[] {
    const found = new Set<string>()

    const patterns = [
        /font-weight\s*:\s*([^;}{\n]+)/gi,
        /\bfontWeight\s*:\s*([^,}{\n]+)/g,
        /['"]fontWeight['"]\s*:\s*([^,}{\n]+)/g,
        /font\s*:\s*([^;}{\n]+)/gi,
    ]

    for (const pattern of patterns) {
        for (const match of content.matchAll(pattern)) {
            const tokens = match[1].match(/\b(?:normal|bold|[1-9]00)\b/gi) ?? []
            for (const token of tokens) {
                const normalized = normalizeWeightToken(token)
                if (normalized) found.add(normalized)
            }
        }
    }

    return [...found].sort((a, b) => Number(a) - Number(b))
}

function extractWeightsFromClassUsage(content: string): string[] {
    const found = new Set<string>()

    const namedClassRegex = /\bfont-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/gi
    for (const match of content.matchAll(namedClassRegex)) {
        const mapped = WEIGHT_NAME_TO_NUMERIC[match[1].toLowerCase()]
        if (mapped) found.add(mapped)
    }

    const numericClassRegex = /\bfont-([1-9]00)\b/gi
    for (const match of content.matchAll(numericClassRegex)) {
        const normalized = normalizeWeightToken(match[1])
        if (normalized) found.add(normalized)
    }

    const arbitraryNumericClassRegex = /\bfont-\[(\d{3})\]\b/gi
    for (const match of content.matchAll(arbitraryNumericClassRegex)) {
        const normalized = normalizeWeightToken(match[1])
        if (normalized) found.add(normalized)
    }

    return [...found].sort((a, b) => Number(a) - Number(b))
}

function collectCandidateFiles(dir: string, out: string[]): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name)) continue
            collectCandidateFiles(fullPath, out)
            continue
        }

        if (!entry.isFile()) continue

        const ext = path.extname(entry.name).toLowerCase()
        if (SCAN_EXTENSIONS.has(ext)) {
            out.push(fullPath)
        }
    }
}

function detectUsedStaticWeights(root: string): string[] {
    const files: string[] = []
    collectCandidateFiles(root, files)

    const found = new Set<string>()
    for (const file of files) {
        let content = ''
        try {
            content = fs.readFileSync(file, 'utf-8')
        } catch {
            continue
        }

        const cssWeights = extractWeightsFromCSS(content)
        const classWeights = extractWeightsFromClassUsage(content)
        const weights = [...cssWeights, ...classWeights]
        for (const weight of weights) {
            found.add(weight)
        }
    }

    // Keep regular text rendering safe by always including 400.
    found.add('400')

    return [...found].sort((a, b) => Number(a) - Number(b))
}

function isVariableRangeCSS(css: string): boolean {
    return /font-weight\s*:\s*\d+\s+\d+/i.test(css)
}

function hasPotentialStaticFallback(
    fonts: FontMap,
    root: string,
    cacheDirOption?: string,
): boolean {
    if (Object.keys(fonts).length === 0) return false

    const cacheDir = path.resolve(root, cacheDirOption ?? DEFAULT_CACHE_DIR)

    return Object.entries(fonts).some(([familyName, familyOptions]) => {
        if (familyOptions.weights === 'variable') {
            return false
        }

        if (Array.isArray(familyOptions.weights)) {
            return true
        }

        const slug = toSlug(familyName)
        const cssFile = path.join(cacheDir, `${slug}.css`)
        if (!fs.existsSync(cssFile)) {
            return true
        }

        try {
            const css = fs.readFileSync(cssFile, 'utf-8')
            return !isVariableRangeCSS(css)
        } catch {
            return true
        }
    })
}

// We use `any` for the return type to avoid Vite version type mismatches when consumers use a different Vite version than the plugin was built with.
export default function googleFontsPlugin<const TFonts extends FontMap>(
    options: GoogleFontsPluginOptions<TFonts>,
): any[] {
    let config: ResolvedConfig
    let root: string
    let cssFilePath = ''
    let downloadedFamilies: DownloadedFamily[] = []

    async function loadFonts() {
        const log = (msg: string) => {
            if (config?.logger) {
                config.logger.info(`[google-fonts] ${msg}`, { timestamp: true })
            } else {
                console.log(`[google-fonts] ${msg}`)
            }
        }

        const shouldScanStaticWeights =
            config.command === 'build' &&
            options.optimizeWeights !== false &&
            hasPotentialStaticFallback(options.fonts, root, options.cacheDir)

        if (config.command === 'build' && options.optimizeWeights !== false && !shouldScanStaticWeights) {
            log('Skipping static weight scan: no fonts require static weight optimization.')
        }

        const usedStaticWeights =
            shouldScanStaticWeights
                ? detectUsedStaticWeights(root)
                : undefined

        if (usedStaticWeights && usedStaticWeights.length > 0) {
            log(`Detected used static weights from CSS: ${usedStaticWeights.join(', ')}`)
        }

        log('Loading fonts...')
        downloadedFamilies = await processAllFonts(options, root, log, {
            usedStaticWeights,
        })

        // Generate CSS with relative paths so Vite's native CSS asset processing resolves and emits font files correctly (both dev and build).
        const cacheDir = path.resolve(root, options.cacheDir ?? DEFAULT_CACHE_DIR)
        const fontCSS = generateFontCSS(downloadedFamilies, './fonts/')
        cssFilePath = path.join(cacheDir, 'google-fonts.css')
        fs.mkdirSync(cacheDir, { recursive: true })
        fs.writeFileSync(cssFilePath, fontCSS)

        log(`Done! ${downloadedFamilies.length} font families ready.`)
    }

    // Plugin 1: Core - downloads and caches font files
    const corePlugin: Plugin = {
        name: 'google-fonts',
        enforce: 'pre',

        configResolved(resolvedConfig) {
            config = resolvedConfig
            root = config.root
            const cacheDir = path.resolve(config.root, options.cacheDir ?? DEFAULT_CACHE_DIR)
            cssFilePath = path.join(cacheDir, 'google-fonts.css')
        },

        async buildStart() {
            await loadFonts()
        },
    }

    // Plugin 2: CSS injection - auto-imports the font CSS into the entry module
    const cssInjectPlugin: Plugin = {
        name: 'google-fonts:inject',
        enforce: 'pre',

        transform(code, id) {
            // Auto-inject CSS import into the main entry file
            // Detect common entry patterns
            const isEntry =
                /\.(tsx?|jsx?)$/.test(id) &&
                !id.includes('node_modules') &&
                (id.includes('/main.') ||
                    id.includes('/index.') ||
                    id.includes('/entry.') ||
                    id.includes('/app.') ||
                    id.includes('/App.'))

            if (isEntry) {
                const marker = `/* google-fonts-injected */`
                if (code.includes(marker)) return null

                return {
                    code: `import '${cssFilePath}'\n${marker}\n${code}`,
                    map: null,
                }
            }

            return null
        },
    }

    // Plugin 3: Preload injection - adds <link rel="preload"> for font files into the HTML
    const preloadPlugin: Plugin = {
        name: 'google-fonts:preload',

        transformIndexHtml: {
            order: 'post',
            handler(_html, ctx) {
                const tags: Array<{
                    tag: string
                    attrs: Record<string, string>
                    injectTo: 'head'
                }> = []

                if (config.command === 'build' && ctx.bundle) {
                    // Build mode: find actual hashed font files from the bundle
                    const slugs = downloadedFamilies.map((f) => f.slug)
                    const base = config.base.endsWith('/')
                        ? config.base
                        : config.base + '/'

                    for (const chunk of Object.values(ctx.bundle)) {
                        if (
                            chunk.type === 'asset' &&
                            chunk.fileName.endsWith('.woff2') &&
                            slugs.some((slug) =>
                                path.basename(chunk.fileName).startsWith(
                                    slug + '-',
                                ),
                            )
                        ) {
                            tags.push({
                                tag: 'link',
                                attrs: {
                                    rel: 'preload',
                                    as: 'font',
                                    type: 'font/woff2',
                                    href: base + chunk.fileName,
                                    crossorigin: '',
                                },
                                injectTo: 'head',
                            })
                        }
                    }
                } else {
                    // Dev mode: compute URLs relative to project root
                    for (const family of downloadedFamilies) {
                        for (const file of family.files) {
                            const relativePath = path.relative(
                                root,
                                file.localPath,
                            )
                            tags.push({
                                tag: 'link',
                                attrs: {
                                    rel: 'preload',
                                    as: 'font',
                                    type: 'font/woff2',
                                    href:
                                        '/' +
                                        relativePath
                                            .split(path.sep)
                                            .join('/'),
                                    crossorigin: '',
                                },
                                injectTo: 'head',
                            })
                        }
                    }
                }

                return tags
            },
        },
    }

    return [corePlugin, cssInjectPlugin, preloadPlugin]
}
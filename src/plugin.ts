import fs from 'node:fs'
import path from 'node:path'
import { normalizePath, type Plugin, type ResolvedConfig } from 'vite'
import {
    isGoogleFontFamily,
    toFamilyName,
    type FontMap,
    type GoogleFontFamily,
    type GoogleFontsPluginOptions,
} from './types.js'
import {
    processAllFonts,
    generateFontCSS,
    toSlug,
    DEFAULT_CACHE_DIR,
    resolveFontBaseDir,
    validateGoogleFontsOptions,
    type DownloadedFamily,
} from './core.js'
import { detectUsedStaticWeights } from './weights.js'

function isVariableRangeCSS(css: string): boolean {
    return /font-weight\s*:\s*\d+\s+\d+/i.test(css)
}

function hasPotentialStaticFallback(
    fonts: GoogleFontsPluginOptions['fonts'],
    root: string,
    cacheDirOption?: string,
): boolean {
    if (Object.keys(fonts).length === 0) return false

    const cacheDir = path.resolve(root, cacheDirOption ?? DEFAULT_CACHE_DIR)

    return Object.entries(fonts).some(([familyKey, familyOptions]) => {
        const weights = (familyOptions as { weights?: unknown })?.weights
        if (!familyOptions || weights === 'variable') {
            return false
        }

        if (Array.isArray(weights)) {
            return true
        }

        const slug = isGoogleFontFamily(familyKey)
            ? toSlug(toFamilyName(familyKey))
            : toSlug(familyKey)
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
export default function googleFontsPlugin<TOptimize extends boolean = true>(
    options: {
        cacheDir?: string
        base?: string
        optimizeWeights?: TOptimize
        fonts: FontMap<[TOptimize] extends [false] ? false : true>
    },
): any[]
export default function googleFontsPlugin(
    options: GoogleFontsPluginOptions,
): any[] {
    validateGoogleFontsOptions(options)

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
                ? detectUsedStaticWeights(root, {
                    ignoredPaths: [path.resolve(root, options.cacheDir ?? DEFAULT_CACHE_DIR)],
                })
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
        const fontBaseDir = resolveFontBaseDir(options.base)
        const fontCSS = generateFontCSS(downloadedFamilies, `./${fontBaseDir}/`)
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
                    code: `import '${normalizePath(cssFilePath)}'\n${marker}\n${code}`,
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
                const seenHrefs = new Set<string>()

                const pushPreload = (href: string) => {
                    if (seenHrefs.has(href)) {
                        return
                    }

                    seenHrefs.add(href)
                    tags.push({
                        tag: 'link',
                        attrs: {
                            rel: 'preload',
                            as: 'font',
                            type: 'font/woff2',
                            href,
                            crossorigin: '',
                        },
                        injectTo: 'head',
                    })
                }

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
                            pushPreload(base + chunk.fileName)
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
                            pushPreload('/' + relativePath.split(path.sep).join('/'))
                        }
                    }
                }

                return tags
            },
        },
    }

    return [corePlugin, cssInjectPlugin, preloadPlugin]
}

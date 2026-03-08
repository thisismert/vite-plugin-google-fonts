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

const GENERIC_ENTRY_CANDIDATES = [
    'src/main.ts',
    'src/main.tsx',
    'src/main.js',
    'src/main.jsx',
    'src/index.ts',
    'src/index.tsx',
    'src/index.js',
    'src/index.jsx',
    'src/app.ts',
    'src/app.tsx',
    'src/app.js',
    'src/app.jsx',
    'src/client.ts',
    'src/client.tsx',
    'src/client.js',
    'src/client.jsx',
    'src/entry-client.ts',
    'src/entry-client.tsx',
    'src/entry-client.js',
    'src/entry-client.jsx',
    'app/client.ts',
    'app/client.tsx',
    'app/client.js',
    'app/client.jsx',
    'app/entry-client.ts',
    'app/entry-client.tsx',
    'app/entry-client.js',
    'app/entry-client.jsx',
]

const FRAMEWORK_ENTRY_CANDIDATES = [
    {
        packages: ['@tanstack/start', '@tanstack/react-start'],
        entries: [
            'src/router.tsx',
            'src/router.ts',
            'app/client.tsx',
            'app/client.ts',
            'src/client.tsx',
            'src/client.ts',
        ],
    },
    {
        packages: ['@sveltejs/kit'],
        entries: [
            'src/hooks.client.ts',
            'src/hooks.client.js',
        ],
    },
    {
        packages: ['react', 'react-dom', '@vitejs/plugin-react', '@vitejs/plugin-react-swc'],
        entries: [
            'src/main.tsx',
            'src/main.jsx',
            'src/index.tsx',
            'src/index.jsx',
        ],
    },
    {
        packages: ['vue', '@vitejs/plugin-vue'],
        entries: [
            'src/main.ts',
            'src/main.js',
        ],
    },
    {
        packages: ['solid-js', '@solidjs/start'],
        entries: [
            'src/main.tsx',
            'src/index.tsx',
            'src/entry-client.tsx',
            'app/client.tsx',
        ],
    },
    {
        packages: ['preact', '@preact/preset-vite'],
        entries: [
            'src/main.tsx',
            'src/main.jsx',
            'src/index.tsx',
            'src/index.jsx',
        ],
    },
    {
        packages: ['@remix-run/react'],
        entries: [
            'app/entry.client.tsx',
            'app/entry.client.jsx',
            'app/entry.client.ts',
            'app/entry.client.js',
        ],
    },
    {
        packages: ['@builder.io/qwik'],
        entries: [
            'src/entry.dev.tsx',
            'src/entry.preview.tsx',
        ],
    },
]

function stripQueryAndHash(id: string): string {
    return normalizePath(id.split('?')[0].split('#')[0])
}

function hasJavaScriptLikeExtension(filePath: string): boolean {
    return /\.[cm]?[jt]sx?$/.test(filePath)
}

function resolveEntryPath(root: string, entry: string): string {
    const trimmedEntry = entry.trim()

    return normalizePath(
        path.isAbsolute(trimmedEntry)
            ? trimmedEntry
            : path.resolve(root, trimmedEntry),
    )
}

function resolveConfiguredEntryFiles(
    root: string,
    entryOption: string | string[],
): Set<string> {
    const configuredEntries = Array.isArray(entryOption)
        ? entryOption
        : [entryOption]

    if (configuredEntries.length === 0) {
        throw new Error('Expected "entry" to contain at least one file path.')
    }

    if (
        configuredEntries.some(
            (entry) => typeof entry !== 'string' || entry.trim().length === 0,
        )
    ) {
        throw new Error(
            'Expected "entry" to be a non-empty string or an array of non-empty strings.',
        )
    }

    const resolvedEntries = configuredEntries.map((entry) =>
        resolveEntryPath(root, entry),
    )
    const nonModuleEntries = resolvedEntries.filter(
        (entryPath) => !hasJavaScriptLikeExtension(entryPath),
    )

    if (nonModuleEntries.length > 0) {
        throw new Error(
            `Configured entry file must be a JS/TS module: ${nonModuleEntries.join(', ')}`,
        )
    }

    const missingEntries = resolvedEntries.filter(
        (entryPath) => !fs.existsSync(entryPath),
    )

    if (missingEntries.length > 0) {
        throw new Error(
            `Configured entry file was not found: ${missingEntries.join(', ')}`,
        )
    }

    return new Set(resolvedEntries)
}

function readProjectPackageNames(root: string): Set<string> {
    const packageJsonPath = path.join(root, 'package.json')

    if (!fs.existsSync(packageJsonPath)) {
        return new Set<string>()
    }

    try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
            dependencies?: Record<string, string>
            devDependencies?: Record<string, string>
            peerDependencies?: Record<string, string>
            optionalDependencies?: Record<string, string>
        }

        return new Set<string>([
            ...Object.keys(packageJson.dependencies ?? {}),
            ...Object.keys(packageJson.devDependencies ?? {}),
            ...Object.keys(packageJson.peerDependencies ?? {}),
            ...Object.keys(packageJson.optionalDependencies ?? {}),
        ])
    } catch {
        return new Set<string>()
    }
}

function resolveFallbackEntryFiles(root: string): string[] {
    const packageNames = readProjectPackageNames(root)
    const candidates = new Set<string>()

    for (const framework of FRAMEWORK_ENTRY_CANDIDATES) {
        if (framework.packages.some((packageName) => packageNames.has(packageName))) {
            for (const entry of framework.entries) {
                candidates.add(entry)
            }
        }
    }

    for (const entry of GENERIC_ENTRY_CANDIDATES) {
        candidates.add(entry)
    }

    return [...candidates]
        .map((entry) => normalizePath(path.join(root, entry)))
        .filter((entryPath) => fs.existsSync(entryPath))
}

function resolveCssInjectionEntries(
    root: string,
    entryOption?: GoogleFontsPluginOptions['entry'],
): Set<string> {
    if (entryOption !== undefined) {
        return resolveConfiguredEntryFiles(root, entryOption)
    }

    return new Set(resolveFallbackEntryFiles(root))
}

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
        entry?: string | string[]
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
    let cssInjectionEntries = new Set<string>()

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
            cssInjectionEntries = resolveCssInjectionEntries(root, options.entry)
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
            const normalizedId = stripQueryAndHash(id)
            const isEntry =
                hasJavaScriptLikeExtension(normalizedId) &&
                !normalizedId.includes('/node_modules/') &&
                cssInjectionEntries.has(normalizedId)

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

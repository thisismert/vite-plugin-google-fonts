import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { type Plugin, type ResolvedConfig } from 'vite'
import { googleFontCatalog } from './generated/font-catalog.js'
import type {
    GoogleFontFamily,
    GoogleFontsPluginOptions,
} from './types.js'
import {
    DEFAULT_CACHE_DIR,
    generateFontCSS,
    processAllFonts,
    resolveFontBaseDir,
    validateGoogleFontsOptions,
} from './core.js'
import { detectUsedStaticWeights, hasStylesheetImport } from './weights.js'

const DEFAULT_CSS_FILE = 'src/generated/google-fonts.css'
const resolveFromPlugin = createRequire(import.meta.url)

function isTailwindInstalled(root: string): boolean {
    try {
        resolveFromPlugin.resolve('tailwindcss', { paths: [root] })
        return true
    } catch {
        return false
    }
}

function toPosixPath(value: string): string {
    return value.split(path.sep).join('/')
}

function resolveCssFile(root: string, cssFile: string | undefined): string {
    const value = cssFile?.trim() || DEFAULT_CSS_FILE
    const resolved = path.resolve(root, value)

    if (path.extname(resolved).toLowerCase() !== '.css') {
        throw new Error(`Generated CSS file must use the .css extension: ${value}`)
    }

    return resolved
}

function resolveFontBasePath(
    cssFilePath: string,
    cacheDir: string,
    fontBaseDir: string,
): string {
    const fontsDir = path.join(cacheDir, fontBaseDir)
    const relativePath = toPosixPath(
        path.relative(path.dirname(cssFilePath), fontsDir),
    )

    if (!relativePath) {
        return './'
    }

    return relativePath.startsWith('.')
        ? `${relativePath}/`
        : `./${relativePath}/`
}

function hasStaticFontFamily(fonts: GoogleFontsPluginOptions['fonts']): boolean {
    return Object.keys(fonts).some((family) => {
        const metadata = googleFontCatalog[family as GoogleFontFamily]
        return metadata?.variable === false
    })
}

export default function googleFontsPlugin(
    options: GoogleFontsPluginOptions,
): Plugin[] {
    validateGoogleFontsOptions(options)

    let config!: ResolvedConfig
    let root = ''
    let tailwindInstalled = false
    let hasShownImportNotice = false

    const logInfo = (message: string) => {
        config.logger.info(`[google-fonts] ${message}`, { timestamp: true })
    }

    const logWarning = (message: string) => {
        config.logger.warn(`[google-fonts] ${message}`, { timestamp: true })
    }

    const plugin: Plugin = {
        name: 'google-fonts',
        enforce: 'pre',

        configResolved(resolvedConfig) {
            config = resolvedConfig
            root = config.root
            tailwindInstalled = isTailwindInstalled(root)
        },

        async buildStart() {
            const cssFilePath = resolveCssFile(root, options.cssFile)
            const cacheDir = path.resolve(
                root,
                options.cacheDir ?? DEFAULT_CACHE_DIR,
            )
            const shouldScanWeights =
                config.command === 'build' &&
                options.optimizeWeights !== false &&
                hasStaticFontFamily(options.fonts)
            const usedStaticWeights = shouldScanWeights
                ? detectUsedStaticWeights(root, {
                    ignoredPaths: [cacheDir, cssFilePath],
                })
                : undefined

            if (usedStaticWeights?.length) {
                logInfo(
                    `Detected static weights: ${usedStaticWeights.join(', ')}`,
                )
            }

            logInfo('Loading fonts...')
            const downloadedFamilies = await processAllFonts(
                options,
                root,
                logInfo,
                { usedStaticWeights },
            )

            const fontBaseDir = resolveFontBaseDir(options.base)
            const fontCSS = generateFontCSS(
                downloadedFamilies,
                resolveFontBasePath(cssFilePath, cacheDir, fontBaseDir),
                tailwindInstalled,
            )

            fs.mkdirSync(path.dirname(cssFilePath), { recursive: true })
            fs.writeFileSync(cssFilePath, fontCSS)

            logInfo(
                `Generated ${toPosixPath(path.relative(root, cssFilePath))}`,
            )

            if (
                config.command === 'serve' &&
                !hasShownImportNotice &&
                !hasStylesheetImport(root, cssFilePath, {
                    ignoredPaths: [cacheDir, cssFilePath],
                })
            ) {
                hasShownImportNotice = true
                logWarning(
                    `Generated stylesheet is not imported: ${toPosixPath(path.relative(root, cssFilePath))}. Add it to your application's CSS entry file.`,
                )
            }
        },
    }

    return [plugin]
}

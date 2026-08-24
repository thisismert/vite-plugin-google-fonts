import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { type Plugin, type ResolvedConfig } from 'vite'
import { googleFontCatalog } from './generated/font-catalog.js'
import type {
    GoogleFontFamily,
    GoogleFontsPluginOptions,
} from './types.js'
import {
    generateFontCSS,
    processAllFonts,
    validateGoogleFontsOptions,
} from './core.js'
import { detectUsedStaticWeights, hasStylesheetImport } from './weights.js'
import {
    GENERATED_CSS_FILE_NAME,
    GENERATED_CSS_IMPORT,
    getPackageRoot,
} from './package-paths.js'

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

function errorCode(error: unknown): string | undefined {
    if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string'
    ) {
        return error.code
    }

    return undefined
}

function canRetryGeneratedCSSReplacement(error: unknown): boolean {
    return ['EEXIST', 'EPERM', 'ENOTEMPTY', 'EXDEV'].includes(errorCode(error) ?? '')
}

function replaceGeneratedCSS(
    temporaryPath: string,
    filePath: string,
): void {
    try {
        fs.renameSync(temporaryPath, filePath)
        return
    } catch (error) {
        if (!canRetryGeneratedCSSReplacement(error)) {
            throw error
        }
    }

    const hasExistingFile = fs.existsSync(filePath)
    const backupPath = hasExistingFile
        ? `${filePath}.${randomUUID()}.bak`
        : undefined

    if (backupPath) {
        fs.renameSync(filePath, backupPath)
    }

    try {
        try {
            fs.renameSync(temporaryPath, filePath)
        } catch (error) {
            if (errorCode(error) !== 'EXDEV') {
                throw error
            }

            fs.copyFileSync(temporaryPath, filePath)
            fs.unlinkSync(temporaryPath)
        }
    } catch (error) {
        if (backupPath) {
            if (fs.existsSync(filePath)) {
                fs.rmSync(filePath, { force: true })
            }
            fs.renameSync(backupPath, filePath)
        }

        throw error
    }

    if (backupPath && fs.existsSync(backupPath)) {
        fs.rmSync(backupPath, { force: true })
    }
}

function writeGeneratedCSS(filePath: string, content: string): void {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`

    try {
        fs.writeFileSync(temporaryPath, content)

        // Replacing the directory entry avoids modifying a packaged placeholder that may be hard-linked by pnpm.
        replaceGeneratedCSS(temporaryPath, filePath)
    } catch (error) {
        if (fs.existsSync(temporaryPath)) {
            fs.rmSync(temporaryPath, { force: true })
        }
        throw error
    }
}

function resolveFontPath(
    cssFilePath: string,
    fontsDir: string,
): string {
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

export default function googleFonts(
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
            const packageRoot = getPackageRoot(root)
            const cssFilePath = path.join(
                packageRoot,
                GENERATED_CSS_FILE_NAME,
            )
            const cacheRoot = path.join(packageRoot, '.cache')
            const fontsDir = path.join(cacheRoot, 'fonts')
            const shouldScanWeights =
                config.command === 'build' &&
                options.optimizeWeights !== false &&
                hasStaticFontFamily(options.fonts)
            const usedStaticWeights = shouldScanWeights
                ? detectUsedStaticWeights(root, {
                    ignoredPaths: [cacheRoot, cssFilePath],
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
                packageRoot,
                logInfo,
                { usedStaticWeights },
            )

            const fontCSS = generateFontCSS(
                downloadedFamilies,
                resolveFontPath(cssFilePath, fontsDir),
                tailwindInstalled,
            )

            fs.mkdirSync(path.dirname(cssFilePath), { recursive: true })
            writeGeneratedCSS(cssFilePath, fontCSS)

            logInfo(
                `Generated ${toPosixPath(path.relative(root, cssFilePath))}`,
            )

            if (
                config.command === 'serve' &&
                !hasShownImportNotice &&
                !hasStylesheetImport(root, cssFilePath, {
                    ignoredPaths: [cacheRoot, cssFilePath],
                    importSpecifierTargets: {
                        [GENERATED_CSS_IMPORT]: cssFilePath,
                    },
                })
            ) {
                hasShownImportNotice = true
                logWarning(
                    `Generated stylesheet is not imported: ${GENERATED_CSS_IMPORT}. Add it to your application's CSS entry file.`,
                )
            }
        },
    }

    return [plugin]
}

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedConfig } from 'vite'
import type { GoogleFontsPluginOptions } from '../src/types.js'

vi.mock('../src/fetch.js', async () => {
    const actual = await vi.importActual<typeof import('../src/fetch.js')>(
        '../src/fetch.js',
    )

    return {
        ...actual,
        fetchGoogleFontCSS: vi.fn(),
        downloadFontFile: vi.fn(),
    }
})

const packagePathMock = vi.hoisted(() => ({ packageRoot: '' }))

vi.mock('../src/package-paths.js', () => ({
    GENERATED_CSS_FILE_NAME: 'fonts.css',
    GENERATED_CSS_IMPORT: 'vite-plugin-google-fonts/fonts.css',
    getPackageRoot: () => packagePathMock.packageRoot,
}))

import * as fetchApi from '../src/fetch.js'
import googleFontsPlugin from '../src/plugin.js'

let root: string
let packageRoot: string

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'google-fonts-plugin-'))
    packageRoot = path.join(root, 'node_modules', 'vite-plugin-google-fonts')
    fs.mkdirSync(packageRoot, { recursive: true })
    packagePathMock.packageRoot = packageRoot
    vi.clearAllMocks()
    vi.mocked(fetchApi.fetchGoogleFontCSS).mockResolvedValue(
        '/* latin */\n@font-face { src: url(https://example.com/inter.woff2); }',
    )
    vi.mocked(fetchApi.downloadFontFile).mockResolvedValue(
        Buffer.from('font bytes'),
    )
})

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
})

function createConfig(
    command: 'serve' | 'build',
    logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> },
): ResolvedConfig {
    return {
        root,
        command,
        logger,
    } as unknown as ResolvedConfig
}

function getHookFunction(
    hook: unknown,
): ((...args: never[]) => unknown) | undefined {
    if (typeof hook === 'function') {
        return hook as (...args: never[]) => unknown
    }

    if (
        hook &&
        typeof hook === 'object' &&
        'handler' in hook &&
        typeof hook.handler === 'function'
    ) {
        return hook.handler as (...args: never[]) => unknown
    }

    return undefined
}

function resolveConfig(plugin: ReturnType<typeof googleFontsPlugin>[number], config: ResolvedConfig): void {
    const hook = getHookFunction(plugin.configResolved) as
        | ((config: ResolvedConfig) => void)
        | undefined

    if (!hook) {
        throw new Error('Plugin does not define configResolved')
    }

    hook(config)
}

async function runBuildStart(
    plugin: ReturnType<typeof googleFontsPlugin>[number],
): Promise<void> {
    const hook = getHookFunction(plugin.buildStart) as
        | (() => void | Promise<void>)
        | undefined

    if (!hook) {
        throw new Error('Plugin does not define buildStart')
    }

    await hook()
}

describe('googleFontsPlugin', () => {
    it('generates the package stylesheet and uses its relative font base', async () => {
        const logger = { info: vi.fn(), warn: vi.fn() }
        const options: GoogleFontsPluginOptions = {
            cacheDir: 'font-cache',
            base: 'assets/fonts',
            fonts: { Inter: { variable: '--font-sans' } },
        }
        fs.mkdirSync(path.join(root, 'src'), { recursive: true })
        fs.writeFileSync(
            path.join(root, 'src', 'index.css'),
            '@import "vite-plugin-google-fonts/fonts.css";',
        )
        const plugin = googleFontsPlugin(options)[0]
        resolveConfig(plugin, createConfig('serve', logger))

        await runBuildStart(plugin)

        const generatedPath = path.join(packageRoot, 'fonts.css')
        const generatedCSS = fs.readFileSync(generatedPath, 'utf8')

        expect(plugin.name).toBe('google-fonts')
        expect(plugin.enforce).toBe('pre')
        expect(generatedCSS).toContain('font-cache/assets/fonts/inter-')
        expect(generatedCSS).toContain("--font-sans: 'Inter', system-ui, sans-serif;")
        expect(generatedCSS).not.toContain('@theme inline')
        expect(fs.existsSync(path.join(packageRoot, 'font-cache', 'meta.json'))).toBe(true)
        expect(fs.existsSync(path.join(root, 'src/generated/fonts.css'))).toBe(false)
        expect(fs.existsSync(path.join(root, 'fonts.css'))).toBe(false)
        expect(logger.info).toHaveBeenCalledWith(
            '[google-fonts] Generated node_modules/vite-plugin-google-fonts/fonts.css',
            { timestamp: true },
        )
        expect(logger.warn).not.toHaveBeenCalled()
    })

    it('emits the Tailwind theme when Tailwind is installed', async () => {
        const logger = { info: vi.fn(), warn: vi.fn() }
        const tailwindPath = path.join(root, 'node_modules', 'tailwindcss')
        fs.mkdirSync(tailwindPath, { recursive: true })
        fs.writeFileSync(
            path.join(tailwindPath, 'package.json'),
            JSON.stringify({ name: 'tailwindcss', main: 'index.js' }),
        )
        fs.writeFileSync(path.join(tailwindPath, 'index.js'), '')

        const plugin = googleFontsPlugin({
            fonts: { Inter: { variable: '--font-sans' } },
        })[0]
        resolveConfig(plugin, createConfig('build', logger))

        await runBuildStart(plugin)

        const generatedCSS = fs.readFileSync(
            path.join(packageRoot, 'fonts.css'),
            'utf8',
        )
        expect(generatedCSS).toContain('@theme inline')
    })

    it('warns once when the generated stylesheet is not imported during dev', async () => {
        const logger = { info: vi.fn(), warn: vi.fn() }
        const plugin = googleFontsPlugin({
            fonts: { Inter: {} },
        })[0]
        resolveConfig(plugin, createConfig('serve', logger))

        await runBuildStart(plugin)
        await runBuildStart(plugin)

        expect(logger.warn).toHaveBeenCalledTimes(1)
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('vite-plugin-google-fonts/fonts.css'),
            { timestamp: true },
        )
    })
})

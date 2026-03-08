import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMocks = vi.hoisted(() => ({
    buildGoogleFontsUrl: vi.fn(),
    fetchGoogleFontCSS: vi.fn(),
    fetchAvailableStaticWeightsCSS: vi.fn(),
    extractFontFileUrls: vi.fn(),
    downloadFontFile: vi.fn(),
}))

vi.mock('../src/fetch.js', async () => {
    const actual = await vi.importActual('../src/fetch.js')
    return {
        ...actual,
        buildGoogleFontsUrl: fetchMocks.buildGoogleFontsUrl,
        fetchGoogleFontCSS: fetchMocks.fetchGoogleFontCSS,
        fetchAvailableStaticWeightsCSS: fetchMocks.fetchAvailableStaticWeightsCSS,
        extractFontFileUrls: fetchMocks.extractFontFileUrls,
        downloadFontFile: fetchMocks.downloadFontFile,
    }
})

const { default: googleFonts } = await import('../src/plugin.js')

function createTempProject() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'vite-google-fonts-'))
}

function createResolvedConfig(root, logger) {
    return {
        root,
        command: 'build',
        base: '/',
        logger,
    }
}

describe('fail-fast font downloads', () => {
    const tempDirs = []

    beforeEach(() => {
        fetchMocks.buildGoogleFontsUrl.mockReset()
        fetchMocks.fetchGoogleFontCSS.mockReset()
        fetchMocks.fetchAvailableStaticWeightsCSS.mockReset()
        fetchMocks.extractFontFileUrls.mockReset()
        fetchMocks.downloadFontFile.mockReset()
        fetchMocks.buildGoogleFontsUrl.mockReturnValue('https://fonts.googleapis.com/css2?family=Inter')
    })

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('fails the build when CSS cannot be fetched', async () => {
        const root = createTempProject()
        tempDirs.push(root)
        const logger = { info: vi.fn() }

        fetchMocks.fetchGoogleFontCSS.mockRejectedValue(new Error('network unavailable'))
        fetchMocks.fetchAvailableStaticWeightsCSS.mockRejectedValue(new Error('no static fallback'))

        const [corePlugin] = googleFonts({
            fonts: {
                Inter: {},
            },
        })

        corePlugin.configResolved(createResolvedConfig(root, logger))

        await expect(corePlugin.buildStart()).rejects.toThrow(
            /Failed to fetch CSS for Inter: no static fallback/,
        )
        expect(logger.info).toHaveBeenCalledWith(
            expect.stringContaining('Failed to fetch CSS for Inter: no static fallback'),
            { timestamp: true },
        )
    })

    it('fails the build when any font file cannot be downloaded', async () => {
        const root = createTempProject()
        tempDirs.push(root)
        const logger = { info: vi.fn() }

        fetchMocks.fetchGoogleFontCSS.mockResolvedValue('/* latin */\n@font-face { src: url(https://fonts.gstatic.com/inter.woff2); }')
        fetchMocks.fetchAvailableStaticWeightsCSS.mockResolvedValue({
            css: '/* latin */\n@font-face { src: url(https://fonts.gstatic.com/inter.woff2); }',
            weights: ['400'],
        })
        fetchMocks.extractFontFileUrls.mockReturnValue([
            {
                url: 'https://fonts.gstatic.com/inter.woff2',
                subset: 'latin',
            },
        ])
        fetchMocks.downloadFontFile.mockRejectedValue(new Error('socket hang up'))

        const [corePlugin] = googleFonts({
            fonts: {
                Inter: {},
            },
        })

        corePlugin.configResolved(createResolvedConfig(root, logger))

        await expect(corePlugin.buildStart()).rejects.toThrow(
            /Failed to download font file for Inter \(latin\): https:\/\/fonts.gstatic.com\/inter.woff2 - socket hang up/,
        )
        expect(logger.info).toHaveBeenCalledWith(
            expect.stringContaining('Failed to download font file for Inter (latin): https://fonts.gstatic.com/inter.woff2 - socket hang up'),
            { timestamp: true },
        )
    })
})
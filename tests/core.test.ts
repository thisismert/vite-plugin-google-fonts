import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

import * as fetchApi from '../src/fetch.js'
import {
    generateFontCSS,
    processAllFonts,
    validateGoogleFontsOptions,
} from '../src/core.js'

let root: string

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'google-fonts-core-'))
    vi.clearAllMocks()
})

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
})

describe('validateGoogleFontsOptions', () => {
    it('accepts valid variable and static configurations', () => {
        expect(() =>
            validateGoogleFontsOptions({
                fonts: {
                    Inter: { variable: '--font-sans' },
                },
            }),
        ).not.toThrow()

        expect(() =>
            validateGoogleFontsOptions({
                optimizeWeights: false,
                fonts: {
                    Agdasima: {
                        weights: [400, 700],
                        styles: ['normal'],
                        subsets: ['latin'],
                    },
                },
            }),
        ).not.toThrow()
    })

    it.each([
        ['unknown families', { fonts: { Does_Not_Exist: {} } }, 'Unknown Google font family'],
        ['invalid variables', { fonts: { Inter: { variable: 'font-sans' } } }, 'valid CSS custom property'],
        ['invalid display values', { fonts: { Inter: { display: 'sometimes' } } }, 'one of'],
        ['unsupported styles', { fonts: { Agdasima: { styles: ['italic'] } } }, 'does not support style'],
        ['unsupported subsets', { fonts: { Agdasima: { subsets: ['cyrillic'] } } }, 'does not support subset'],
        ['unsupported weights', { optimizeWeights: false, fonts: { Agdasima: { weights: [500] } } }, 'does not support weight'],
        ['weights with optimization', { fonts: { Agdasima: { weights: [400] } } }, 'cannot specify "weights"'],
    ] as const)('rejects %s', (_case, options, message) => {
        expect(() =>
            validateGoogleFontsOptions(
                options as unknown as GoogleFontsPluginOptions,
            ),
        ).toThrow(message)
    })
})

describe('generateFontCSS', () => {
    it('rewrites font paths and emits canonical, custom, and theme variables', () => {
        const css = generateFontCSS(
            [
                {
                    family: 'Inter',
                    slug: 'inter',
                    css: '@font-face { src: url(__FONT_PATH__inter.woff2); }',
                    variable: '--font-sans',
                    fallback: 'system-ui, sans-serif',
                },
                {
                    family: 'JetBrains Mono',
                    slug: 'jetbrains-mono',
                    css: '@font-face { src: url(__FONT_PATH__mono.woff2); }',
                    variable: '--font-mono',
                    fallback: 'ui-monospace, monospace',
                },
            ],
            '../.cache/fonts/',
            true,
        )

        expect(css).toContain('url(../.cache/fonts/inter.woff2)')
        expect(css).toContain("--font-sans: 'Inter', system-ui, sans-serif;")
        expect(css).toContain("--font-inter: 'Inter', system-ui, sans-serif;")
        expect(css).toContain(
            "--font-mono: 'JetBrains Mono', ui-monospace, monospace;",
        )
        expect(css).toContain("--font-jetbrains-mono: 'JetBrains Mono'")
        expect(css).toContain('@theme inline')
        expect(css).toContain('  --font-sans: var(--font-sans);')
        expect(css).toContain('  --font-mono: var(--font-mono);')
    })

    it('does not emit the Tailwind theme without Tailwind', () => {
        const css = generateFontCSS(
            [
                {
                    family: 'Inter',
                    slug: 'inter',
                    css: '',
                    variable: '--font-sans',
                    fallback: 'system-ui, sans-serif',
                },
            ],
            'fonts/',
        )

        expect(css).not.toContain('@theme inline')
        expect(css).toContain("--font-sans: 'Inter', system-ui, sans-serif;")
    })
})

describe('processAllFonts', () => {
    const staticOptions: GoogleFontsPluginOptions = {
        optimizeWeights: false,
        fonts: {
            Agdasima: {
                weights: [400],
                styles: ['normal'],
                subsets: ['latin'],
            },
        },
    }

    it('downloads selected subsets, writes a manifest, and reuses a complete cache', async () => {
        vi.mocked(fetchApi.fetchGoogleFontCSS).mockResolvedValue(`
/* cyrillic */
@font-face { src: url(https://example.com/cyrillic.woff2); }
/* latin */
@font-face { src: url(https://example.com/latin.woff2); }
`)
        vi.mocked(fetchApi.downloadFontFile).mockResolvedValue(
            Buffer.from('font bytes'),
        )

        const log = vi.fn()
        const first = await processAllFonts(staticOptions, root, log)
        const fontsDir = path.join(root, '.cache', 'fonts')
        const cachedFiles = fs.readdirSync(fontsDir)
        const expectedHash = crypto
            .createHash('sha256')
            .update(Buffer.from('font bytes'))
            .digest('hex')
            .slice(0, 8)

        expect(first).toHaveLength(1)
        expect(first[0].css).toContain(
            `__FONT_PATH__agdasima-latin-${expectedHash}.woff2`,
        )
        expect(first[0].css).not.toContain('cyrillic')
        expect(cachedFiles).toEqual([
            `agdasima-latin-${expectedHash}.woff2`,
        ])
        expect(JSON.parse(fs.readFileSync(path.join(root, '.cache/meta.json'), 'utf8'))).toMatchObject({
            agdasima: expect.any(String),
        })
        expect(fetchApi.fetchGoogleFontCSS).toHaveBeenCalledWith(
            expect.stringContaining('family=Agdasima%3Awght%40400'),
        )

        vi.clearAllMocks()
        const second = await processAllFonts(staticOptions, root, log)

        expect(second[0].css).toBe(first[0].css)
        expect(fetchApi.fetchGoogleFontCSS).not.toHaveBeenCalled()
        expect(fetchApi.downloadFontFile).not.toHaveBeenCalled()
    })

    it('uses detected static weights when optimization is enabled', async () => {
        const options: GoogleFontsPluginOptions = {
            fonts: { Agdasima: {} },
        }
        vi.mocked(fetchApi.fetchGoogleFontCSS).mockResolvedValue(
            '/* latin */\n@font-face { src: url(https://example.com/agdasima.woff2); }',
        )
        vi.mocked(fetchApi.downloadFontFile).mockResolvedValue(
            Buffer.from('font bytes'),
        )

        await processAllFonts(options, root, vi.fn(), {
            usedStaticWeights: ['700', '900'],
        })

        expect(fetchApi.fetchGoogleFontCSS).toHaveBeenCalledWith(
            expect.stringContaining('family=Agdasima%3Awght%40700'),
        )
        expect(fetchApi.fetchGoogleFontCSS).not.toHaveBeenCalledWith(
            expect.stringContaining('900'),
        )
    })

    it('does not prune cached files for families with a shared slug prefix', async () => {
        vi.mocked(fetchApi.fetchGoogleFontCSS).mockImplementation(
            async (url) => {
                const family = new URL(url).searchParams.get('family') ?? ''
                const slug = family.startsWith('Inter Tight')
                    ? 'inter-tight'
                    : 'inter'

                return `/* latin */\n@font-face { src: url(https://example.com/${slug}.woff2); }`
            },
        )
        vi.mocked(fetchApi.downloadFontFile).mockResolvedValue(
            Buffer.from('font bytes'),
        )

        const firstOptions: GoogleFontsPluginOptions = {
            optimizeWeights: false,
            fonts: {
                Inter: { subsets: ['latin'] },
                Inter_Tight: { subsets: ['latin'] },
            },
        }

        await processAllFonts(firstOptions, root, vi.fn())
        vi.clearAllMocks()

        const updatedOptions: GoogleFontsPluginOptions = {
            ...firstOptions,
            fonts: {
                Inter: {
                    subsets: ['latin'],
                    display: 'block',
                },
                Inter_Tight: { subsets: ['latin'] },
            },
        }

        await processAllFonts(updatedOptions, root, vi.fn())

        expect(fetchApi.fetchGoogleFontCSS).toHaveBeenCalledTimes(1)
        expect(fetchApi.downloadFontFile).toHaveBeenCalledTimes(1)
        expect(fs.readdirSync(path.join(root, '.cache', 'fonts'))).toEqual([
            expect.stringMatching(/^inter-latin-[a-f0-9]+\.woff2$/),
            expect.stringMatching(/^inter-tight-latin-[a-f0-9]+\.woff2$/),
        ])
    })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    buildGoogleFontsUrl,
    extractFontFileUrls,
    fetchGoogleFontCSS,
} from '../src/fetch.js'

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('buildGoogleFontsUrl', () => {
    it('builds a static font URL for normal weights', () => {
        const url = new URL(
            buildGoogleFontsUrl('Roboto', {
                weights: ['400', '700'],
                styles: ['normal'],
                display: 'swap',
            }),
        )

        expect(url.origin + url.pathname).toBe('https://fonts.googleapis.com/css2')
        expect(url.searchParams.get('family')).toBe('Roboto:wght@400;700')
        expect(url.searchParams.get('display')).toBe('swap')
    })

    it('builds the italic axis when both styles are requested', () => {
        const url = new URL(
            buildGoogleFontsUrl('Roboto', {
                weights: ['700', '400'],
                styles: ['normal', 'italic'],
                display: 'optional',
            }),
        )

        expect(url.searchParams.get('family')).toBe(
            'Roboto:ital,wght@0,400;0,700;1,400;1,700',
        )
    })

    it('builds variable ranges for normal and italic styles', () => {
        const url = new URL(
            buildGoogleFontsUrl('Inter', {
                weights: ['variable'],
                styles: ['normal', 'italic'],
                display: 'swap',
                weightRange: '100..900',
            }),
        )

        expect(url.searchParams.get('family')).toBe(
            'Inter:ital,wght@0,100..900;1,100..900',
        )
    })

    it('rejects incomplete font requests', () => {
        expect(() =>
            buildGoogleFontsUrl('Inter', {
                weights: ['variable'],
                styles: ['normal'],
                display: 'swap',
            }),
        ).toThrow('Variable font range is missing for Inter')

        expect(() =>
            buildGoogleFontsUrl('Inter', {
                weights: [],
                styles: [],
                display: 'swap',
            }),
        ).toThrow('No font weights were provided for Inter')
    })
})

describe('extractFontFileUrls', () => {
    it('extracts unique remote files and associates their subsets', () => {
        const css = `
/* cyrillic */
@font-face { src: url("https://example.com/cyrillic.woff2"); }
/* latin */
@font-face { src: url(https://example.com/latin.woff2) format('woff2'); }
@font-face { src: url(https://example.com/latin.woff2); }
@font-face { src: url(data:font/woff2;base64,AAAA); }
`

        expect(extractFontFileUrls(css)).toEqual([
            { subset: 'cyrillic', url: 'https://example.com/cyrillic.woff2' },
            { subset: 'latin', url: 'https://example.com/latin.woff2' },
        ])
    })
})

describe('fetchGoogleFontCSS', () => {
    it('retries failed requests before returning the stylesheet', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 503,
                text: async () => 'temporarily unavailable',
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 503,
                text: async () => '',
            })
            .mockResolvedValueOnce({
                ok: true,
                arrayBuffer: async () =>
                    new TextEncoder().encode('font css').buffer,
            })
        vi.stubGlobal('fetch', fetchMock)

        await expect(
            fetchGoogleFontCSS('https://fonts.googleapis.com/css2?family=Inter'),
        ).resolves.toBe('font css')

        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(fetchMock.mock.calls[0][1]).toMatchObject({
            headers: {
                'User-Agent': expect.stringContaining('Mozilla/5.0'),
            },
        })
    })
})

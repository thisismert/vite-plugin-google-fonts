import { describe, expect, it } from 'vitest'

import {
    getDefaultFallbackForFamily,
    validateGoogleFontsOptions,
} from '../src/core.js'
import {
    googleFontFamilies,
    isGoogleFontFamily,
} from '../src/types.js'

describe('runtime validation', () => {
    it('exports family helpers', () => {
        expect(googleFontFamilies).toContain('Inter')
        expect(isGoogleFontFamily('Inter')).toBe(true)
        expect(isGoogleFontFamily('inter')).toBe(false)
    })

    it('throws for unknown families with a suggestion', () => {
        expect(() =>
            validateGoogleFontsOptions({
                fonts: {
                    inter: {},
                },
            }),
        ).toThrow(/Unknown Google font family "inter"\. Did you mean "Inter"\?/)
    })

    it('throws for unsupported subsets', () => {
        expect(() =>
            validateGoogleFontsOptions({
                fonts: {
                    Inter: {
                        subsets: ['japanese'],
                    },
                },
            }),
        ).toThrow(/Font family "Inter" does not support subset "japanese"/)
    })

    it('throws for unsupported styles', () => {
        expect(() =>
            validateGoogleFontsOptions({
                fonts: {
                    Recursive: {
                        styles: ['italic'],
                    },
                },
            }),
        ).toThrow(/Font family "Recursive" does not support style "italic"/)
    })

    it('throws for unsupported weights', () => {
        expect(() =>
            validateGoogleFontsOptions({
                optimizeWeights: false,
                fonts: {
                    JetBrains_Mono: {
                        weights: [900],
                    },
                },
            }),
        ).toThrow(/Font family "JetBrains_Mono" does not support weight "900"/)
    })

    it('throws for unsupported variable weights', () => {
        expect(() =>
            validateGoogleFontsOptions({
                optimizeWeights: false,
                fonts: {
                    Abel: {
                        weights: 'variable',
                    },
                },
            }),
        ).toThrow(/Font family "Abel" does not support variable weights/)
    })

    it('throws when weights are used with optimizeWeights enabled', () => {
        expect(() =>
            validateGoogleFontsOptions({
                fonts: {
                    Inter: {
                        weights: [400],
                    },
                },
            }),
        ).toThrow(/cannot specify "weights" unless "optimizeWeights" is set to false/)
    })

    it('accepts valid strict configs', () => {
        const options = {
            optimizeWeights: false,
            fonts: {
                Inter: {
                    weights: 'variable',
                    styles: ['normal', 'italic'],
                    subsets: ['latin'],
                    variable: '--font-sans',
                },
                Recursive: {
                    weights: [300, 400],
                    styles: ['normal'],
                    subsets: ['latin'],
                },
            },
        }

        const snapshot = JSON.parse(JSON.stringify(options))
        validateGoogleFontsOptions(options)
        expect(options).toStrictEqual(snapshot)
    })

    it('uses category-based fallback defaults', () => {
        expect(getDefaultFallbackForFamily('Inter')).toBe('system-ui, sans-serif')
        expect(getDefaultFallbackForFamily('JetBrains_Mono')).toBe('ui-monospace, monospace')
        expect(getDefaultFallbackForFamily('Merriweather')).toBe('ui-serif, serif')
    })
})

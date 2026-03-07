/**
 * Types for vite-plugin-google-fonts
 */

/** Options for a single font family */
export interface FontFamilyOptions {
    /**
     * CSS custom property name assigned on :root.
     * @example '--font-sans'
     */
    variable?: string

    /**
     * Font weights to include.
     * Use string ('variable') for variable fonts.
     * If omitted, the plugin tries variable first and falls back to available static weights.
     * @example [400, 500, 600, 700]
     * @example 'variable'
     */
    weights?: number[] | 'variable'

    /**
     * Font styles to include.
     * @default ['normal']
     * @example ['normal', 'italic']
     */
    styles?: ('normal' | 'italic')[]

    /**
     * Character subsets to include.
     * @default ['latin']
     * @example ['latin', 'latin-ext', 'cyrillic']
     */
    subsets?: string[]

    /**
     * Font display strategy.
     * @default 'swap'
     */
    display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional'

    /**
     * Fallback font stack appended after the font family name.
     * @default 'sans-serif'
     * @example 'serif'
     * @example 'system-ui, sans-serif'
     */
    fallback?: string
}

/** Mapping from font family to per-family options. */
export type FontMap = Record<string, FontFamilyOptions>

// Shared plugin options (excluding font-map and optimizeWeights).
interface GoogleFontsPluginOptionsBase {
    /**
     * Directory to cache downloaded font files (relative to project root).
     * @default 'node_modules/.google-fonts'
     */
    cacheDir?: string

    /**
     * Relative directory under `cacheDir` used for downloaded font files and generated CSS URLs.
     * @default 'fonts'
     */
    base?: string
}

/**
 * Plugin options.
 *
 * When `optimizeWeights` is `true`, the `weights` option is not available
 * per-font family (the plugin will determine the needed weights automatically
 * by scanning the project's CSS/source files).
 */
export type GoogleFontsPluginOptions<TFonts extends FontMap = FontMap> =
    GoogleFontsPluginOptionsBase & (
        | {
            /**
             * During build, limit static fallback downloads for non-variable fonts to the font-weight values used in the project's CSS files.
             * Optimization is not applied during dev server (current behavior is preserved).
             * Scans CSS files, Tailwind classes and inline styles for font-weight values.
             * Only applies to non-variable fonts, as variable fonts already include all weights in a single file.
             * @default true
             */
            optimizeWeights?: true

            /**
             * Font families to download and self-host.
             * Key is the font family name (e.g. 'Inter', 'Roboto Mono').
             * Value is per-family options.
             *
             * Note: `weights` is not available when `optimizeWeights` is `true`.
             *
             * @example
             * ```ts
             * fonts: {
             *   Inter: { variable: '--font-sans' },
             *   'Playfair Display': { variable: '--font-serif' },
             *   'JetBrains Mono': { variable: '--font-mono' },
             * }
             * ```
             */
            fonts: Record<string, Omit<FontFamilyOptions, 'weights'>>
        }
        | {
            /**
             * During build, limit static fallback downloads for non-variable fonts to the font-weight values used in the project's CSS files.
             * Optimization is not applied during dev server (current behavior is preserved).
             * Scans CSS files, Tailwind classes and inline styles for font-weight values.
             * Only applies to non-variable fonts, as variable fonts already include all weights in a single file.
             * @default true
             */
            optimizeWeights: false

            /**
             * Font families to download and self-host.
             * Key is the font family name (e.g. 'Inter', 'Roboto Mono').
             * Value is per-family options.
             *
             * @example
             * ```ts
             * fonts: {
             *   Inter: { variable: '--font-sans', weights: [400, 700] },
             *   'Playfair Display': { variable: '--font-serif' },
             *   'JetBrains Mono': { variable: '--font-mono' },
             * }
             * ```
             */
            fonts: TFonts
        }
    )

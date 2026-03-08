import { googleFontCatalog } from './generated/font-catalog.js'

/**
 * Types for vite-plugin-google-fonts
 */

export type GoogleFontCatalog = typeof googleFontCatalog
export type GoogleFontFamily = keyof GoogleFontCatalog
export type GoogleFontWeight<TFamily extends GoogleFontFamily> =
    GoogleFontCatalog[TFamily]['weights'][number]
export type GoogleFontStyle<TFamily extends GoogleFontFamily> =
    GoogleFontCatalog[TFamily]['styles'][number]
export type GoogleFontSubset<TFamily extends GoogleFontFamily> =
    GoogleFontCatalog[TFamily]['subsets'][number]
export type GoogleFontCategory<TFamily extends GoogleFontFamily> =
    GoogleFontCatalog[TFamily]['category']
export type GoogleFontSupportsVariable<TFamily extends GoogleFontFamily> =
    GoogleFontCatalog[TFamily]['variable']

export const googleFontFamilies = Object.freeze(
    Object.keys(googleFontCatalog),
) as readonly GoogleFontFamily[]

export function isGoogleFontFamily(value: string): value is GoogleFontFamily {
    return Object.hasOwn(googleFontCatalog, value)
}

/**
 * Get the canonical Google Fonts family name for a catalog key.
 * e.g. 'JetBrains_Mono' → 'JetBrains Mono'
 */
export function toFamilyName(key: GoogleFontFamily): string {
    return googleFontCatalog[key].family
}

export type FontDisplay = 'auto' | 'block' | 'swap' | 'fallback' | 'optional'

interface FontFamilyOptionsBase<TFamily extends GoogleFontFamily> {
    /**
     * CSS custom property name assigned on :root.
     * @example '--font-sans'
     */
    variable?: `--${string}`

    /**
     * Font styles to include.
     * @default ['normal']
     * @example ['normal', 'italic']
     */
    styles?: GoogleFontStyle<TFamily>[]

    /**
     * Character subsets to include.
     * @default ['latin']
     * @example ['latin', 'latin-ext', 'cyrillic']
     */
    subsets?: GoogleFontSubset<TFamily>[]

    /**
     * Font display strategy.
     * @default 'swap'
     */
    display?: FontDisplay

    /**
     * Fallback font stack appended after the font family name.
     * @default 'sans-serif'
     * @example 'serif'
     * @example 'system-ui, sans-serif'
     */
    fallback?: string
}

type FontWeights<TFamily extends GoogleFontFamily> =
    | GoogleFontWeight<TFamily>[]
    | (GoogleFontSupportsVariable<TFamily> extends true ? 'variable' : never)

/** Options for a single font family. */
export type FontFamilyOptions<
    TFamily extends GoogleFontFamily = GoogleFontFamily,
    TOptimize extends boolean = false,
> = FontFamilyOptionsBase<TFamily> &
    ([TOptimize] extends [false]
        ? {
            /**
             * Font weights to include when `optimizeWeights: false`.
             * Use `'variable'` only when the family supports variable fonts.
             * If omitted, the plugin tries variable first and falls back to
             * available static weights automatically.
             */
            weights?: FontWeights<TFamily>
        }
        : {})

/** Mapping from canonical Google font family names to per-family options. */
export type FontMap<TOptimize extends boolean = false> = Partial<{
    [K in GoogleFontFamily]: FontFamilyOptions<K, TOptimize>
}>

interface GoogleFontsPluginOptionsBase<TOptimize extends boolean> {
    /**
     * Directory to cache downloaded font files (relative to project root).
     * @default 'node_modules/.google-fonts'
     */
    cacheDir?: string

    /**
     * Application entry file(s) that should receive the generated CSS import.
     * Values may be relative to the Vite project root or absolute paths.
     * If omitted, the plugin falls back to framework-specific and common Vite entry file names.
     */
    entry?: string | string[]

    /**
     * Relative directory under `cacheDir` used for downloaded font files and generated CSS URLs.
     * @default 'fonts'
     */
    base?: string

    /**
     * Font families to download and self-host.
     * Keys must be canonical Google Fonts family names.
     */
    fonts: FontMap<TOptimize>
}

export type OptimizedGoogleFontsPluginOptions = GoogleFontsPluginOptionsBase<true> & {
    /**
     * During build, limit static fallback downloads for non-variable fonts to the font-weight values used in the project's CSS files.
     * Optimization is not applied during dev server (current behavior is preserved).
     * Scans CSS files, Tailwind classes and inline styles for font-weight values.
     * Only applies to non-variable fonts, as variable fonts already include all weights in a single file.
     * @default true
     */
    optimizeWeights?: true
}

export type ManualGoogleFontsPluginOptions = GoogleFontsPluginOptionsBase<false> & {
    /**
     * Disable automatic static-weight optimization and control weights manually.
     */
    optimizeWeights: false
}

export type DynamicGoogleFontsPluginOptions = GoogleFontsPluginOptionsBase<true> & {
    /**
     * A runtime boolean keeps the safe, optimized type surface.
     * Manual `weights` remain unavailable unless the value is known to be `false`.
     */
    optimizeWeights: boolean
}

/**
 * Plugin options.
 *
 * When `optimizeWeights` is `true`, the `weights` option is not available
 * per-font family.
 */
export type GoogleFontsPluginOptions =
    | OptimizedGoogleFontsPluginOptions
    | ManualGoogleFontsPluginOptions
    | DynamicGoogleFontsPluginOptions

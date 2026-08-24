import { googleFontCatalog } from './generated/font-catalog.js'

export type GoogleFontFamily = keyof typeof googleFontCatalog
export type GoogleFontWeight<TFamily extends GoogleFontFamily> =
    (typeof googleFontCatalog)[TFamily]['weights'][number]
export type GoogleFontStyle<TFamily extends GoogleFontFamily> =
    (typeof googleFontCatalog)[TFamily]['styles'][number]
export type GoogleFontSubset<TFamily extends GoogleFontFamily> =
    (typeof googleFontCatalog)[TFamily]['subsets'][number]
export type GoogleFontCategory<TFamily extends GoogleFontFamily> =
    (typeof googleFontCatalog)[TFamily]['category']
export type GoogleFontSupportsVariable<TFamily extends GoogleFontFamily> =
    (typeof googleFontCatalog)[TFamily]['variable']

export const googleFontFamilies = Object.freeze(
    Object.keys(googleFontCatalog),
) as readonly GoogleFontFamily[]

export function isGoogleFontFamily(value: string): value is GoogleFontFamily {
    return Object.hasOwn(googleFontCatalog, value)
}

export type FontDisplay = 'auto' | 'block' | 'swap' | 'fallback' | 'optional'

type FontWeights<TFamily extends GoogleFontFamily> =
    | readonly GoogleFontWeight<TFamily>[]
    | (GoogleFontSupportsVariable<TFamily> extends true ? 'variable' : never)

export type FontFamilyOptions<
    TFamily extends GoogleFontFamily = GoogleFontFamily,
    TOptimize extends boolean = false,
> = {
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
    styles?: readonly GoogleFontStyle<TFamily>[]

    /**
     * Character subsets to include.
     * @default ['latin']
     * @example ['latin', 'latin-ext', 'cyrillic']
     */
    subsets?: readonly GoogleFontSubset<TFamily>[]

    /**
     * Font display strategy.
     * @default 'swap'
     */
    display?: FontDisplay

    /**
     * Fallback font stack appended after the font family name.
     * @default category-specific system stack
     * @example 'serif'
     * @example 'system-ui, sans-serif'
     */
    fallback?: string
} &
    ([TOptimize] extends [false]
        ? {
            /**
             * Font weights to include when `optimizeWeights: false`.
             * Use `'variable'` only when the family supports variable fonts.
             * If omitted, the plugin uses a variable font when available and
             * otherwise requests all catalog-supported static weights.
             */
            weights?: FontWeights<TFamily>
        }
        : {})

export type FontMap<TOptimize extends boolean = false> = Partial<{
    [K in GoogleFontFamily]: FontFamilyOptions<K, TOptimize>
}>

type SharedPluginOptions = {
    /**
     * Directory to cache downloaded font files (relative to project root).
     * @default 'node_modules/.google-fonts'
     */
    cacheDir?: string

    /**
     * Workspace-relative path for the generated stylesheet.
     * @default 'src/generated/google-fonts.css'
     */
    cssFile?: string

    /**
     * Relative directory under `cacheDir` used for downloaded font files and generated CSS URLs.
     * @default 'fonts'
     */
    base?: string
}

export type GoogleFontsPluginOptions =
    | (SharedPluginOptions & {
        /**
         * During build, limit static downloads to weights found in the project.
         * @default true
         */
        optimizeWeights?: true
        fonts: FontMap<true>
    })
    | (SharedPluginOptions & {
        /**
         * Disable automatic static-weight optimization and control weights manually.
         */
        optimizeWeights: false
        fonts: FontMap<false>
    })

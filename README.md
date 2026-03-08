# vite-plugin-google-fonts

Self-host Google Fonts in Vite by downloading the font files at build/dev startup, rewriting the Google CSS to local asset URLs, injecting the stylesheet automatically, and preloading the emitted `woff2` files.

This is a thing that I vibecoded for using in a project but now I'm using it on all of my projects that uses Vite. So I decided to publish it.

## What it does

- Downloads the configured Google Fonts and stores them in a local cache.
- Rewrites `@font-face` rules to local file paths so Vite handles the assets normally.
- Injects the generated stylesheet into your app entry automatically.
- Adds `<link rel="preload" as="font">` tags for the emitted font files.
- Prefers variable fonts when available.
- Falls back to static weights automatically when a variable font is unavailable.
- Optionally scans your source files during build to keep static-weight downloads limited to the weights you actually use.

## Install

```bash
npm install vite-plugin-google-fonts
```

Peer requirement:

- `vite >= 4`
- `node >= 18`

TypeScript note:

- Canonical Google font family names are now type-checked strictly
- `styles`, `subsets`, and manual `weights` are validated per family
- This is a semver-major type change for TS consumers upgrading from the older loose `Record<string, ...>` API

## Quick start

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import googleFonts from 'vite-plugin-google-fonts'

export default defineConfig({
  plugins: [
    googleFonts({
      fonts: {
        Inter: {
          variable: '--font-sans',
        },
        JetBrains_Mono: {
          variable: '--font-mono',
        },
      },
    }),
  ],
})
```

Then use the generated CSS variables or font names anywhere in your app:

```css
:root {
  color-scheme: light;
}

body {
  font-family: var(--font-sans);
}

code,
pre {
  font-family: "JetBrains Mono", monospace;
}
```

## Generated CSS variables

Each configured family always gets a canonical variable:

- `Inter` -> `--font-inter`
- `Roboto Mono` -> `--font-roboto-mono`

If you also pass `variable`, that custom property is generated too.

Example:

```ts
googleFonts({
  fonts: {
    Inter: {
      variable: '--font-sans',
    },
  },
})
```

Generates:

```css
:root {
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-inter: 'Inter', system-ui, sans-serif;
}
```

## Configuration

```ts
import type { GoogleFontsPluginOptions } from 'vite-plugin-google-fonts'
```

Additional exports:

```ts
import {
  googleFontFamilies,
  isGoogleFontFamily,
  type GoogleFontFamily,
  type GoogleFontSubset,
  type GoogleFontStyle,
  type GoogleFontWeight,
} from 'vite-plugin-google-fonts'
```

### Plugin options

```ts
type OptimizedGoogleFontsPluginOptions = {
  cacheDir?: string
  base?: string
  optimizeWeights?: true
  fonts: Partial<{
    [K in GoogleFontFamily]: FontFamilyOptions<K, true>
  }>
}

type ManualGoogleFontsPluginOptions = {
  cacheDir?: string
  base?: string
  optimizeWeights: false
  fonts: Partial<{
    [K in GoogleFontFamily]: FontFamilyOptions<K, false>
  }>
}

type DynamicGoogleFontsPluginOptions =
  import('vite-plugin-google-fonts').DynamicGoogleFontsPluginOptions

type GoogleFontsPluginOptions =
  | OptimizedGoogleFontsPluginOptions
  | ManualGoogleFontsPluginOptions
  | DynamicGoogleFontsPluginOptions
```

### Per-font options

```ts
type FontFamilyOptions<TFamily extends GoogleFontFamily, TOptimize extends boolean> = {
  variable?: `--${string}`
  styles?: Array<GoogleFontStyle<TFamily>>
  subsets?: Array<GoogleFontSubset<TFamily>>
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional'
  fallback?: string
} & (
  TOptimize extends false
    ? {
        weights?: Array<GoogleFontWeight<TFamily>> | 'variable'
      }
    : {
        weights?: never
      }
)
```

## Type safety

- Font keys must be canonical Google Fonts family names such as `Inter` or `'JetBrains Mono'`
- `styles`, `subsets`, and `weights` are derived from metadata for that specific family
- `weights: 'variable'` is only accepted for families that support variable downloads
- When `optimizeWeights` is omitted or `true`, `weights` is removed from the type surface and rejected at runtime too

Example:

```ts
googleFonts({
  optimizeWeights: false,
  fonts: {
    Inter: {
      weights: 'variable',
      styles: ['normal', 'italic'],
      subsets: ['latin', 'latin-ext'],
    },
    Recursive: {
      weights: [300, 400, 500],
      styles: ['normal'],
    },
  },
})
```

### Dynamic configs

If you build font configs dynamically, use the helper exports to narrow user input before constructing the config object:

```ts
import { googleFontFamilies, isGoogleFontFamily } from 'vite-plugin-google-fonts'

for (const family of googleFontFamilies) {
  console.log(family)
}

const family = process.env.FONT_FAMILY ?? 'Inter'

if (isGoogleFontFamily(family)) {
  // `family` is now narrowed to `GoogleFontFamily`
  console.log(`Using supported family: ${family}`)
}
```

### `cacheDir`

Directory used for the generated CSS, metadata, and downloaded font files.

- Default: `node_modules/.google-fonts`
- Value is resolved relative to the Vite project root

### `optimizeWeights`

When `true` during `vite build`, the plugin scans your project files for used font weights and narrows static-font downloads to those weights.

- Default: `true`
- Variable fonts are unaffected because they already cover a range of weights in one file
- When `optimizeWeights` is `true`, per-font `weights` are intentionally omitted from the type surface

Disable it if you want full manual control over static weights:

```ts
googleFonts({
  optimizeWeights: false,
  fonts: {
    Roboto: {
      weights: [400, 500, 700],
      styles: ['normal', 'italic'],
    },
  },
})
```

### `base`

Relative directory inside `cacheDir` where downloaded font files are stored and where the generated CSS points.

- Default: `'fonts'`
- Example: `base: 'assets/fonts'`

```ts
googleFonts({
  cacheDir: '.vite/google-fonts',
  base: 'assets/fonts',
  fonts: {
    Inter: {},
  },
})
```

### `weights`

Controls which font weights are requested for a single family when `optimizeWeights: false`.

- `weights: 'variable'` requests the variable version when Google Fonts supports it
- `weights: [400, 700]` requests only static weights supported by that family
- If `weights` is omitted, the plugin first tries a variable font and falls back to available static weights automatically

### `styles`

Controls the style variants supported by the selected family.

```ts
googleFonts({
  optimizeWeights: false,
  fonts: {
    Inter: {
      weights: 'variable',
      styles: ['normal', 'italic'],
    },
  },
})
```

### `subsets`

Filters the downloaded `@font-face` blocks to the requested subsets.

- Default: `['latin']`
- Example: `['latin', 'latin-ext']`
- Only subsets available for the selected family are accepted by the type surface and runtime validator

If Google Fonts does not return the requested subset labels for a family, the plugin keeps the original CSS instead of emitting an empty stylesheet.

### `display`

Sets the `font-display` strategy used in the Google Fonts CSS request.

- Default: `'swap'`

### `fallback`

Fallback font stack appended after the configured family.

- Default depends on detected font category:
  - sans-serif -> `'system-ui, sans-serif'`
  - serif -> `'ui-serif, serif'`
  - monospace -> `'ui-monospace, monospace'`
  - other categories fall back to `'sans-serif'`

Example:

```ts
googleFonts({
  fonts: {
    Merriweather: {
      fallback: 'Georgia, serif',
    },
  },
})
```

## Behavior notes

- The plugin uses local asset URLs, not runtime requests to `fonts.googleapis.com`.
- The generated stylesheet is written into the cache directory as `google-fonts.css`.
- Font files are cached using content-hashed filenames.
- The cache is reused across runs and stale files for a family are cleaned up automatically.
- During build, preload tags point at the final emitted font assets.
- During dev, preload tags point at the cached files inside your project.

## Example setups

### Variable-first setup

```ts
googleFonts({
  fonts: {
    Inter: {
      variable: '--font-sans',
    },
    Playfair_Display: {
      variable: '--font-serif',
      fallback: 'Georgia, serif',
    },
  },
})
```

### Explicit static weights

```ts
googleFonts({
  optimizeWeights: false,
  fonts: {
    Roboto: {
      weights: [400, 700],
      styles: ['normal', 'italic'],
      subsets: ['latin', 'latin-ext'],
    },
  },
})
```

## Limitations

- Automatic stylesheet injection relies on conventional Vite entry filenames such as `main.ts`, `main.tsx`, `index.ts`, `app.tsx`, and similar entry modules.
- Weight optimization is based on static source scanning. Runtime-generated class names or styles cannot be detected.
- This package currently targets Node-based Vite workflows, not browser-only environments.

## Development

```bash
npm run generate:catalog
npm run typecheck
npm test
npm run build
```

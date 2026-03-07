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
          fallback: 'system-ui, sans-serif',
        },
        'JetBrains Mono': {
          variable: '--font-mono',
          fallback: 'ui-monospace, monospace',
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
      fallback: 'system-ui, sans-serif',
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

### Plugin options

```ts
type GoogleFontsPluginOptions = {
  cacheDir?: string
  base?: string
  optimizeWeights?: boolean
  fonts: Record<string, FontFamilyOptions>
}
```

### Per-font options

```ts
type FontFamilyOptions = {
  variable?: string
  weights?: number[] | 'variable'
  styles?: Array<'normal' | 'italic'>
  subsets?: string[]
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional'
  fallback?: string
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
- `weights: [400, 700]` requests only those static weights
- If `weights` is omitted, the plugin first tries a variable font and falls back to available static weights automatically

### `styles`

Controls `normal` and/or `italic` variants.

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

If Google Fonts does not return the requested subset labels for a family, the plugin keeps the original CSS instead of emitting an empty stylesheet.

### `display`

Sets the `font-display` strategy used in the Google Fonts CSS request.

- Default: `'swap'`

### `fallback`

Fallback font stack appended after the configured family.

- Default: `'sans-serif'`

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
      fallback: 'system-ui, sans-serif',
    },
    'Playfair Display': {
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
npm run typecheck
npm run build
```

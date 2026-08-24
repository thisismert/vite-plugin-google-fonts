# vite-plugin-google-fonts

A Vite plugin that downloads Google Fonts at startup, stores the font files in a local cache, and generates a workspace stylesheet with local `@font-face` rules, CSS variables, and Tailwind theme mappings.

This was something I vibecoded to use in a project, but then I decided to release it as a seperate project.

I am still working on docs, for now you can check below for basic usage and options. If you have any questions, feel free to open an issue.

## Installation

```bash
pn i vite-plugin-google-fonts
```

## Usage

The plugin generates `src/generated/fonts.css` by default. Import that file from the application's CSS entry after configuring the plugin.

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

```css
/* src/index.css */
@import "tailwindcss";
@import "./generated/fonts.css";
```

```ts
// src/main.tsx
import './index.css'
```

## Features

- Downloads and self hosts fonts so you don't have to rely on Google Fonts CDN.
- Supports variable and static families, including custom weights, styles, and subsets.
- Generates a stylesheet that you can easily use in your application.
- Auto-generates Tailwind theme mappings for variable families so you can use them with Tailwind.
- Typesafe configuration with autocomplete and validation in IDEs. 
- Optimizes static families by scanning source files for used weights and only including those in the generated stylesheet to reduce build times and bundle sizes.

## Options

### `cssFile`

Workspace-relative or absolute path for the generated stylesheet.

Default: `src/generated/fonts.css`

```ts
googleFonts({
  cssFile: 'src/styles/google-fonts.css',
  fonts: { Geist: {} },
})
```

Import the configured file in the application's CSS entry yourself. With Tailwind, place it after `@import "tailwindcss"` so Tailwind expands the generated `@theme inline` block.

During `vite dev`, the plugin scans stylesheet source files for this import and warns if it cannot find one.

### `cacheDir`

The cache directory, relative to the Vite root unless absolute.

Default: `node_modules/.google-fonts`

The cache contains one stylesheet per family, downloaded font files, and a manifest used for cache validation. The combined stylesheet is always written to `cssFile` in the workspace.

### `base`

The relative directory inside `cacheDir` where font files are stored. The generated stylesheet uses the correct relative path from `cssFile` to this directory.

Default: `fonts`

```ts
googleFonts({
  cssFile: 'src/styles/fonts.css',
  cacheDir: '.vite/google-fonts',
  base: 'assets/fonts',
  fonts: { Inter: {} },
})
```

### `optimizeWeights`

Default: `true`

For non-variable families, the plugin scans supported source files for CSS declarations, inline styles, and utility classes such as `font-bold` or `font-700`, then only includes matching catalog weights to reduce build times and bundle sizes.

Variable families are downloaded as one variable font and are not scanned.

Set `optimizeWeights: false` to choose static weights manually (not recommended):

```ts
googleFonts({
  optimizeWeights: false,
  fonts: {
    Poppins: {
      weights: [400, 500, 700],
      styles: ['normal', 'italic'],
      subsets: ['latin', 'latin-ext'],
      variable: '--font-sans',
    },
    Playfair_Display: {
      weights: 'variable',
      variable: '--font-display',
    },
  },
})
```

Without an explicit `weights` value, a variable family uses its variable range and a static family uses all catalog-supported weights.

### Per-family options

- `variable`: Add a custom CSS variable for the family.
- `styles`: Choose font styles You want to include. (defaults to `['normal']`)
- `subsets`: Choose font subsets you want to include. (defaults to `['latin']`)
- `display`: Choose the font display method you want to use. (defaults to `swap`)
- `fallback`: Choose a fallback font stack. (defaults to a category-appropriate system stack: `system-ui, sans-serif` for sans-serif families, `system-ui, monospace` for monospace families)
- `weights`: Choose the custom weights you want to include. Only available when `optimizeWeights: false`. (defaults to all catalog-supported weights)

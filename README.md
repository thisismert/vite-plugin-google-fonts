# vite-plugin-google-fonts

A Vite plugin that downloads Google Fonts at startup, stores the font files in a package-local cache, and generates a package stylesheet with local `@font-face` rules, CSS variables, and Tailwind theme mappings.

This was something I vibecoded to use in a project, but then I decided to release it as a seperate project.

I am still working on docs, for now you can check below for basic usage and options. If you have any questions, feel free to open an issue.

## Installation

```bash
pn i vite-plugin-google-fonts
```

## Usage

The plugin generates `node_modules/vite-plugin-google-fonts/fonts.css`. Import the package stylesheet from the application's CSS entry after configuring the plugin.

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
@import "vite-plugin-google-fonts/fonts.css";
```

```ts
// src/main.tsx
import './index.css'
```

## Features

- Downloads and self hosts fonts so you don't have to rely on Google Fonts CDN.
- Supports variable and static families, including custom weights, styles, and subsets.
- Generates the stylesheet inside the installed package, so no generated files are added to your project source tree.
- Auto-generates Tailwind theme mappings for variable families so you can use them with Tailwind.
- Typesafe configuration with autocomplete and validation in IDEs. 
- Optimizes static families by scanning source files for used weights and only including those in the generated stylesheet to reduce build times and bundle sizes.

## Generated files

The generated stylesheet and cache live in the installed plugin package:

```text
node_modules/vite-plugin-google-fonts/
├── fonts.css
└── .cache/
    ├── meta.json
    ├── <family>.css
    └── fonts/
```

By default, the `.cache` directory contains downloaded font files, one stylesheet per family, and a manifest used for cache validation. It is safe to delete; the plugin recreates it on the next Vite start. Since these files are inside `node_modules`, they do not add generated files to the application source tree.

This output strategy requires a physical, writable `node_modules` installation. Plug'n'Play package setups do not provide a package directory for the generated file and are not supported.

During `vite dev`, the plugin scans stylesheet source files for `vite-plugin-google-fonts/fonts.css` and warns if it cannot find an import.

## Options

### `cacheDir`

The directory inside the installed plugin package used for downloaded font files and cache metadata. It must be a safe relative path and cannot escape the package directory.

Default: `.cache`

```ts
googleFonts({
  cacheDir: 'generated-cache',
  fonts: { Inter: {} },
})
```

### `base`

The relative directory inside `cacheDir` where font files are stored. The generated stylesheet uses the correct relative path from `fonts.css` to this directory.

Default: `fonts`

```ts
googleFonts({
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

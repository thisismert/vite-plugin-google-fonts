import googleFonts, {
    type DynamicGoogleFontsPluginOptions,
    type GoogleFontsPluginOptions,
} from '../src/index.js'

const optimizedConfig = {
    fonts: {
        Inter: {
            styles: ['normal', 'italic'],
            subsets: ['latin', 'latin-ext'],
            variable: '--font-sans',
        },
        Recursive: {
            styles: ['normal'],
            subsets: ['latin'],
        },
    },
} satisfies GoogleFontsPluginOptions

googleFonts(optimizedConfig)

const manualConfig = {
    optimizeWeights: false,
    fonts: {
        Inter: {
            weights: 'variable',
            styles: ['normal', 'italic'],
            subsets: ['latin'],
            variable: '--font-sans',
        },
        JetBrains_Mono: {
            weights: [100, 200, 300, 400, 500, 600, 700, 800],
            styles: ['normal', 'italic'],
            subsets: ['latin', 'latin-ext'],
        },
        Recursive: {
            weights: [300, 400, 500],
            styles: ['normal'],
            subsets: ['latin'],
        },
    },
} satisfies GoogleFontsPluginOptions

googleFonts(manualConfig)

declare const maybeOptimizeWeights: boolean

const dynamicOptimizeConfig = {
    optimizeWeights: maybeOptimizeWeights,
    fonts: {
        Inter: {
            styles: ['normal'],
            subsets: ['latin'],
        },
    },
} satisfies DynamicGoogleFontsPluginOptions

googleFonts(dynamicOptimizeConfig)

const invalidFamily = {
    fonts: {
        // @ts-expect-error Unknown family key.
        inter: {},
    },
} satisfies GoogleFontsPluginOptions

void invalidFamily

const invalidVariableName = {
    fonts: {
        Inter: {
            // @ts-expect-error CSS custom properties must start with `--`.
            variable: 'font-sans',
        },
    },
} satisfies GoogleFontsPluginOptions

void invalidVariableName

const invalidSubset = {
    fonts: {
        Inter: {
            // @ts-expect-error Unsupported subset for Inter.
            subsets: ['japanese'],
        },
    },
} satisfies GoogleFontsPluginOptions

void invalidSubset

const invalidStyle = {
    fonts: {
        Recursive: {
            // @ts-expect-error Recursive only supports `normal`.
            styles: ['italic'],
        },
    },
} satisfies GoogleFontsPluginOptions

void invalidStyle

const invalidWeight = {
    optimizeWeights: false,
    fonts: {
        JetBrains_Mono: {
            // @ts-expect-error JetBrains Mono does not support 900.
            weights: [900],
        },
    },
} satisfies GoogleFontsPluginOptions

void invalidWeight

const invalidVariableWeight = {
    optimizeWeights: false,
    fonts: {
        Abel: {
            // @ts-expect-error Abel is not a variable family.
            weights: 'variable',
        },
    },
} satisfies GoogleFontsPluginOptions

void invalidVariableWeight

const invalidWeightsWhenOptimized = {
    fonts: {
        Inter: {
            // @ts-expect-error `weights` is unavailable when optimizeWeights is omitted.
            weights: [400],
        },
    },
} satisfies GoogleFontsPluginOptions

void invalidWeightsWhenOptimized

const invalidWeightsWhenTrue = {
    optimizeWeights: true,
    fonts: {
        Inter: {
            // @ts-expect-error `weights` is unavailable when optimizeWeights is true.
            weights: [400],
        },
    },
} satisfies GoogleFontsPluginOptions

void invalidWeightsWhenTrue

const invalidWeightsWhenBoolean = {
    optimizeWeights: maybeOptimizeWeights,
    fonts: {
        Inter: {
            // @ts-expect-error `weights` is unavailable unless optimizeWeights is known to be false.
            weights: [400],
        },
    },
} satisfies DynamicGoogleFontsPluginOptions

void invalidWeightsWhenBoolean

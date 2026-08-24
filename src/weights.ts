import fs from 'node:fs'
import path from 'node:path'

const SCAN_EXTENSIONS = new Set([
    '.css',
    '.pcss',
    '.postcss',
    '.scss',
    '.sass',
    '.less',
    '.styl',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.html',
    '.vue',
    '.svelte',
    '.astro',
    '.mdx',
])

const IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    '.output',
    '.tanstack',
    '.vite',
    '.turbo',
    '.next',
    '.nuxt',
    'coverage',
])

const WEIGHT_NAME_TO_NUMERIC: Record<string, string> = {
    thin: '100',
    extralight: '200',
    light: '300',
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
    black: '900',
}

const STYLESHEET_EXTENSIONS = new Set([
    '.css',
    '.pcss',
    '.postcss',
    '.scss',
    '.sass',
    '.less',
    '.styl',
])

const CSS_IMPORT_PATTERN = /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s);]+))\s*\)?/g

function canonicalPath(value: string): string {
    const resolved = path.resolve(value)

    try {
        return fs.realpathSync(resolved)
    } catch {
        return resolved
    }
}

function normalizeWeightToken(token: string): string | null {
    const lower = token.toLowerCase()

    const named = WEIGHT_NAME_TO_NUMERIC[lower]
    if (named) {
        return named
    }

    const numeric = Number.parseInt(lower, 10)
    if (!Number.isFinite(numeric) || numeric < 100 || numeric > 900 || numeric % 100 !== 0) {
        return null
    }

    return String(numeric)
}

function extractWeightsFromCSS(content: string): string[] {
    const found = new Set<string>()

    const patterns = [
        /font-weight\s*:\s*([^;}{\n]+)/gi,
        /\bfontWeight\s*:\s*([^,}{\n]+)/g,
        /['"]fontWeight['"]\s*:\s*([^,}{\n]+)/g,
        /font\s*:\s*([^;}{\n]+)/gi,
    ]

    for (const pattern of patterns) {
        for (const match of content.matchAll(pattern)) {
            const tokens = match[1].match(/\b(?:normal|bold|[1-9]00)\b/gi) ?? []
            for (const token of tokens) {
                const normalized = normalizeWeightToken(token)
                if (normalized) {
                    found.add(normalized)
                }
            }
        }
    }

    return [...found].sort((a, b) => Number(a) - Number(b))
}

function extractWeightsFromClassUsage(content: string): string[] {
    const found = new Set<string>()

    const namedClassRegex = /\bfont-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/gi
    for (const match of content.matchAll(namedClassRegex)) {
        const mapped = WEIGHT_NAME_TO_NUMERIC[match[1].toLowerCase()]
        if (mapped) {
            found.add(mapped)
        }
    }

    const numericClassRegex = /\bfont-([1-9]00)\b/gi
    for (const match of content.matchAll(numericClassRegex)) {
        const normalized = normalizeWeightToken(match[1])
        if (normalized) {
            found.add(normalized)
        }
    }

    const arbitraryNumericClassRegex = /\bfont-\[(\d{3})\]\b/gi
    for (const match of content.matchAll(arbitraryNumericClassRegex)) {
        const normalized = normalizeWeightToken(match[1])
        if (normalized) {
            found.add(normalized)
        }
    }

    return [...found].sort((a, b) => Number(a) - Number(b))
}

function collectCandidateFiles(
    dir: string,
    out: string[],
    ignoredPaths: Set<string>,
): void {
    let entries: fs.Dirent[]
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
        return
    }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        const resolvedFullPath = path.resolve(fullPath)

        if (ignoredPaths.has(resolvedFullPath)) {
            continue
        }

        if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name)) {
                continue
            }

            collectCandidateFiles(fullPath, out, ignoredPaths)
            continue
        }

        if (!entry.isFile()) {
            continue
        }

        const ext = path.extname(entry.name).toLowerCase()
        if (SCAN_EXTENSIONS.has(ext)) {
            out.push(fullPath)
        }
    }
}

function importResolvesToFile(
    importer: string,
    specifier: string,
    root: string,
    targetFile: string,
    importSpecifierTargets: Readonly<Record<string, string>>,
): boolean {
    const cleanSpecifier = specifier.split(/[?#]/, 1)[0]
    const importTarget = importSpecifierTargets[cleanSpecifier]

    if (importTarget !== undefined) {
        return canonicalPath(importTarget) === targetFile
    }

    const targetRelativePath = path.relative(
        canonicalPath(root),
        targetFile,
    ).split(path.sep).join('/')

    if (cleanSpecifier === targetRelativePath) {
        return true
    }

    if (cleanSpecifier === `/${targetRelativePath}`) {
        return true
    }

    const resolvedSpecifier = cleanSpecifier.startsWith('/')
        ? path.resolve(root, cleanSpecifier.slice(1))
        : cleanSpecifier.startsWith('.')
            ? path.resolve(path.dirname(importer), cleanSpecifier)
            : path.resolve(root, cleanSpecifier)

    return canonicalPath(resolvedSpecifier) === targetFile
}

export function hasStylesheetImport(
    root: string,
    targetFile: string,
    options?: {
        ignoredPaths?: string[]
        importSpecifierTargets?: Readonly<Record<string, string>>
    },
): boolean {
    const files: string[] = []
    const ignoredPaths = new Set((options?.ignoredPaths ?? []).map((value) => path.resolve(value)))
    const importSpecifierTargets = options?.importSpecifierTargets ?? {}
    const resolvedTargetFile = canonicalPath(targetFile)

    collectCandidateFiles(root, files, ignoredPaths)

    for (const file of files) {
        if (!STYLESHEET_EXTENSIONS.has(path.extname(file).toLowerCase())) {
            continue
        }

        let content: string
        try {
            content = fs.readFileSync(file, 'utf-8')
        } catch {
            continue
        }

        for (const match of content.matchAll(CSS_IMPORT_PATTERN)) {
            const specifier = match[1] ?? match[2] ?? match[3]
            if (importResolvesToFile(
                file,
                specifier,
                canonicalPath(root),
                resolvedTargetFile,
                importSpecifierTargets,
            )) {
                return true
            }
        }
    }

    return false
}

export function detectUsedStaticWeights(
    root: string,
    options?: {
        ignoredPaths?: string[]
    },
): string[] {
    const files: string[] = []
    const ignoredPaths = new Set((options?.ignoredPaths ?? []).map((value) => path.resolve(value)))

    collectCandidateFiles(root, files, ignoredPaths)

    const found = new Set<string>()
    for (const file of files) {
        let content: string
        try {
            content = fs.readFileSync(file, 'utf-8')
        } catch {
            continue
        }

        for (const weight of extractWeightsFromCSS(content)) {
            found.add(weight)
        }

        for (const weight of extractWeightsFromClassUsage(content)) {
            found.add(weight)
        }
    }

    found.add('400')

    return [...found].sort((a, b) => Number(a) - Number(b))
}

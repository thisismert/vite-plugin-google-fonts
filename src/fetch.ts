const GOOGLE_FONTS_CSS_URL = 'https://fonts.googleapis.com/css2'
const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/126.0.0.0 Safari/537.36'
const REQUEST_TIMEOUT = 15_000

async function fetchBuffer(url: string): Promise<Buffer> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
        })

        if (!response.ok) {
            const body = (await response.text()).replace(/\s+/g, ' ').trim()
            const details = body ? ` - ${body.slice(0, 240)}` : ''
            throw new Error(
                `Request failed (${response.status}): ${url}${details}`,
            )
        }

        return Buffer.from(await response.arrayBuffer())
    } finally {
        clearTimeout(timeout)
    }
}

async function retry<T>(request: () => Promise<T>, attempts: number): Promise<T> {
    let lastError: Error | undefined

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await request()
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error))

            if (attempt < attempts) {
                await new Promise((resolve) => setTimeout(resolve, attempt * 100))
            }
        }
    }

    throw lastError ?? new Error('Request failed')
}

interface GoogleFontsBuildUrlOptions {
    weights: readonly string[]
    styles: readonly string[]
    display: string
    weightRange?: string
}

/** Build a Google Fonts CSS2 API URL from validated catalog options. */
export function buildGoogleFontsUrl(
    family: string,
    options: GoogleFontsBuildUrlOptions,
): string {
    const normalizedFamily = family.trim()
    if (!normalizedFamily) {
        throw new Error('Family name cannot be empty')
    }

    const isVariable = options.weights.includes('variable')
    const hasNormal = options.styles.includes('normal')
    const hasItalic = options.styles.includes('italic')

    if (isVariable) {
        if (!options.weightRange) {
            throw new Error(`Variable font range is missing for ${normalizedFamily}`)
        }

        const weightRange = options.weightRange

        if (hasNormal && hasItalic) {
            return createGoogleFontsUrl(
                `${normalizedFamily}:ital,wght@0,${weightRange};1,${weightRange}`,
                options.display,
            )
        }

        if (hasItalic) {
            return createGoogleFontsUrl(
                `${normalizedFamily}:ital,wght@1,${weightRange}`,
                options.display,
            )
        }

        return createGoogleFontsUrl(
            `${normalizedFamily}:wght@${weightRange}`,
            options.display,
        )
    }

    const values = options.weights.flatMap((weight) => {
        const valuesForWeight: string[] = []

        if (hasNormal) {
            valuesForWeight.push(`0,${weight}`)
        }
        if (hasItalic) {
            valuesForWeight.push(`1,${weight}`)
        }

        return valuesForWeight
    })

    if (values.length === 0) {
        throw new Error(`No font weights were provided for ${normalizedFamily}`)
    }

    values.sort()

    const hasBothStyles = hasNormal && hasItalic
    const axis = hasBothStyles || hasItalic ? 'ital,wght' : 'wght'
    const value = hasBothStyles
        ? values.join(';')
        : values.map((item) => item.replace(/^0,/, '')).join(';')

    return createGoogleFontsUrl(
        `${normalizedFamily}:${axis}@${value}`,
        options.display,
    )
}

function createGoogleFontsUrl(familyQuery: string, display: string): string {
    const params = new URLSearchParams({
        family: familyQuery,
        display,
    })

    return `${GOOGLE_FONTS_CSS_URL}?${params}`
}

export async function fetchGoogleFontCSS(url: string): Promise<string> {
    const buffer = await retry(() => fetchBuffer(url), 3)
    return buffer.toString('utf8')
}

interface FontFileInfo {
    url: string
    subset: string
}

/** Extract the remote font files referenced by a Google Fonts stylesheet. */
export function extractFontFileUrls(css: string): FontFileInfo[] {
    const files: FontFileInfo[] = []
    let currentSubset = ''

    for (const line of css.split('\n')) {
        const subsetMatch = /^\s*\/\*\s*([^*]+?)\s*\*\/\s*$/.exec(line)
        if (subsetMatch) {
            currentSubset = subsetMatch[1]
            continue
        }

        for (const match of line.matchAll(/url\(([^)]+)\)/g)) {
            const url = match[1].trim().replace(/^['"]|['"]$/g, '')
            if (
                !url ||
                url.startsWith('data:') ||
                files.some((file) => file.url === url)
            ) {
                continue
            }

            files.push({ url, subset: currentSubset })
        }
    }

    return files
}

export async function downloadFontFile(url: string): Promise<Buffer> {
    return retry(() => fetchBuffer(url), 4)
}

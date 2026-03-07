import https from 'node:https'
import http from 'node:http'

// We pretend to be a Chrome browser so Google Fonts returns woff2 format.
const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/126.0.0.0 Safari/537.36'

const MAX_REDIRECTS = 5

// Simple GET request returning a Buffer.
function fetchBuffer(url: string, timeout = 15_000, redirectCount = 0): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const { protocol } = new URL(url)
        const client = protocol === 'https:' ? https : http

        const req = client.request(
            url,
            {
                headers: { 'User-Agent': USER_AGENT },
            },
            (res) => {
                // Follow redirects
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    if (redirectCount >= MAX_REDIRECTS) {
                        reject(new Error(`Too many redirects while fetching: ${url}`))
                        return
                    }

                    const nextUrl = new URL(res.headers.location, url).toString()
                    fetchBuffer(nextUrl, timeout, redirectCount + 1).then(resolve, reject)
                    return
                }

                if (res.statusCode !== 200) {
                    const chunks: Buffer[] = []
                    res.on('data', (chunk: Buffer) => chunks.push(chunk))
                    res.on('end', () => {
                        const body = Buffer.concat(chunks).toString('utf-8').replace(/\s+/g, ' ').trim()
                        const details = body ? ` - ${body.slice(0, 240)}` : ''
                        reject(new Error(`Request failed (${res.statusCode}): ${url}${details}`))
                    })
                    res.on('error', reject)
                    return
                }

                const chunks: Buffer[] = []
                res.on('data', (chunk: Buffer) => chunks.push(chunk))
                res.on('end', () => resolve(Buffer.concat(chunks)))
                res.on('error', reject)
            },
        )

        req.setTimeout(timeout, () => {
            req.destroy(new Error(`Request timed out after ${timeout}ms: ${url}`))
        })

        req.on('error', reject)
        req.end()
    })
}

// Retry a fetch up to `retries` times.
async function retry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
    let lastError: Error | undefined
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn()
        } catch (err) {
            lastError = err as Error
            if (i < retries) {
                await new Promise((r) => setTimeout(r, 100 * (i + 1)))
            }
        }
    }
    throw lastError
}

const STATIC_WEIGHT_CANDIDATES = ['100', '200', '300', '400', '500', '600', '700', '800', '900']

export interface GoogleFontsBuildUrlOptions {
    weights: string[]
    styles: string[]
    display: string
    weightRange?: string
}

export interface GoogleFontsFetchOptions {
    weights: string[]
    styles: string[]
    display: string
}

/**
 * Build the Google Fonts CSS2 API URL.
 *
 * @see https://developers.google.com/fonts/docs/css2
 */
export function buildGoogleFontsUrl(
    family: string,
    opts: GoogleFontsBuildUrlOptions,
): string {
    if (!family.trim()) {
        throw new Error('Family name cannot be empty')
    }

    const familyParam = family.trim().replace(/[ _]+/g, '+')

    // Determine axes & values
    const isVariable = opts.weights.includes('variable')
    const hasItal = opts.styles.includes('italic')
    const wghtRange = opts.weightRange ?? '100..900'

    if (isVariable) {
        if (hasItal) {
            const axisSpec = 'ital,wght'
            const valueSpec = `0,${wghtRange};1,${wghtRange}`
            return `https://fonts.googleapis.com/css2?family=${familyParam}:${axisSpec}@${valueSpec}&display=${opts.display}`
        } else {
            const axisSpec = 'wght'
            const valueSpec = wghtRange
            return `https://fonts.googleapis.com/css2?family=${familyParam}:${axisSpec}@${valueSpec}&display=${opts.display}`
        }
    }

    // Static weights
    const axisTags: string[] = []
    if (hasItal) axisTags.push('ital')
    axisTags.push('wght')

    const tuples: string[] = []
    for (const w of opts.weights) {
        if (hasItal) {
            if (opts.styles.includes('normal')) {
                tuples.push(`0,${w}`)
            }
            tuples.push(`1,${w}`)
        } else {
            tuples.push(w)
        }
    }

    tuples.sort()

    const axisSpec = axisTags.join(',')
    const valueSpec = tuples.join(';')

    return `https://fonts.googleapis.com/css2?family=${familyParam}:${axisSpec}@${valueSpec}&display=${opts.display}`
}

/**
 * Fetch the CSS containing '@font-face' declarations from Google Fonts.
 */
export async function fetchGoogleFontCSS(url: string): Promise<string> {
    const buffer = await retry(() => fetchBuffer(url), 2)
    return buffer.toString('utf-8')
}

export async function fetchAvailableStaticWeightsCSS(
    family: string,
    opts: {
        styles: string[]
        display: string
        candidates?: string[]
    },
): Promise<{ css: string; weights: string[] }> {
    const cssChunks: string[] = []
    const availableWeights: string[] = []
    let lastError: Error | undefined

    for (const weight of opts.candidates ?? STATIC_WEIGHT_CANDIDATES) {
        const staticOpts: GoogleFontsFetchOptions = {
            styles: opts.styles,
            display: opts.display,
            weights: [weight],
        }

        try {
            const staticUrl = buildGoogleFontsUrl(family, staticOpts)
            const css = await fetchGoogleFontCSS(staticUrl)
            cssChunks.push(css)
            availableWeights.push(weight)
        } catch (err) {
            lastError = err as Error
        }
    }

    if (cssChunks.length === 0) {
        throw lastError ?? new Error(`No static weights available for ${family}`)
    }

    return {
        css: cssChunks.join('\n'),
        weights: availableWeights,
    }
}

/**
 * Extract all font file URLs from Google Fonts CSS response.
 * Also captures the subset comment above each '@font-face' block.
 */
export interface FontFileInfo {
    url: string
    subset: string
}

export function extractFontFileUrls(css: string): FontFileInfo[] {
    const files: FontFileInfo[] = []
    let currentSubset = ''

    for (const line of css.split('\n')) {
        const subsetMatch = /\/\* (.+?) \*\//.exec(line)
        if (subsetMatch) {
            currentSubset = subsetMatch[1]
            continue
        }

        for (const urlMatch of line.matchAll(/url\(([^)]+)\)/g)) {
            const url = urlMatch[1].trim().replace(/^['"]|['"]$/g, '')
            if (!url || url.startsWith('data:')) {
                continue
            }

            if (!files.some((f) => f.url === url)) {
                files.push({ url, subset: currentSubset })
            }
        }
    }

    return files
}

/**
 * Download a font file and return its Buffer.
 */
export async function downloadFontFile(url: string): Promise<Buffer> {
    return retry(() => fetchBuffer(url), 3)
}

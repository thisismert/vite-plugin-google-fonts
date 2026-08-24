import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    detectUsedStaticWeights,
    hasStylesheetImport,
} from '../src/weights.js'

let root: string

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'google-fonts-weights-'))
})

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
})

describe('detectUsedStaticWeights', () => {
    it('finds declaration, inline-style, shorthand, and utility weights', () => {
        fs.mkdirSync(path.join(root, 'src'), { recursive: true })
        fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
        fs.writeFileSync(
            path.join(root, 'src', 'app.ts'),
            `
const styles = { fontWeight: 600 }
const other = { 'fontWeight': 'medium' }
const classes = 'font-bold font-900'
`,
        )
        fs.writeFileSync(
            path.join(root, 'src', 'app.css'),
            `
.body { font-weight: 700; }
.label { font: italic 500 1rem/1.5 sans-serif; }
`,
        )
        fs.writeFileSync(
            path.join(root, 'node_modules', 'ignored.css'),
            '.ignored { font-weight: 100; }',
        )

        expect(detectUsedStaticWeights(root)).toEqual([
            '400',
            '500',
            '600',
            '700',
            '900',
        ])
    })

    it('ignores configured paths', () => {
        const ignoredFile = path.join(root, 'ignored.ts')
        fs.writeFileSync(ignoredFile, '.ignored { font-weight: 900; }')

        expect(
            detectUsedStaticWeights(root, { ignoredPaths: [ignoredFile] }),
        ).toEqual(['400'])
    })
})

describe('hasStylesheetImport', () => {
    it('resolves relative imports with query strings', () => {
        const importer = path.join(root, 'src', 'index.css')
        const target = path.join(root, 'src', 'generated', 'fonts.css')
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(
            importer,
            '@import url("./generated/fonts.css?inline");',
        )

        expect(hasStylesheetImport(root, target)).toBe(true)
        expect(
            hasStylesheetImport(root, target, { ignoredPaths: [importer] }),
        ).toBe(false)
    })

    it('resolves root-relative imports and rejects other files', () => {
        const importer = path.join(root, 'src', 'index.scss')
        const target = path.join(root, 'src', 'generated', 'fonts.css')
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(importer, '@import "/src/generated/fonts.css";')

        expect(hasStylesheetImport(root, target)).toBe(true)
        expect(
            hasStylesheetImport(root, path.join(root, 'src', 'other.css')),
        ).toBe(false)
    })
})

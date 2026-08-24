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
    it.skipIf(process.platform === 'win32')(
        'resolves aliased imports through a symlinked package path',
        () => {
            const importer = path.join(root, 'src', 'index.css')
            const packageTarget = path.join(
                root,
                '.pnpm/vite-plugin-google-fonts/node_modules/vite-plugin-google-fonts',
            )
            const packageLink = path.join(
                root,
                'node_modules/vite-plugin-google-fonts',
            )
            const targetFile = path.join(packageTarget, 'fonts.css')
            const linkedTargetFile = path.join(packageLink, 'fonts.css')

            fs.mkdirSync(path.dirname(importer), { recursive: true })
            fs.mkdirSync(packageTarget, { recursive: true })
            fs.mkdirSync(path.dirname(packageLink), { recursive: true })
            fs.writeFileSync(targetFile, '')
            fs.symlinkSync(packageTarget, packageLink, 'dir')
            fs.writeFileSync(
                importer,
                '@import "vite-plugin-google-fonts/fonts.css";',
            )

            expect(
                hasStylesheetImport(root, targetFile, {
                    importSpecifierTargets: {
                        'vite-plugin-google-fonts/fonts.css': linkedTargetFile,
                    },
                }),
            ).toBe(true)
        },
    )

    it('only accepts an aliased import when it targets the requested file', () => {
        const importer = path.join(root, 'src', 'index.css')
        const target = path.join(root, 'node_modules', 'vite-plugin-google-fonts', 'fonts.css')
        const otherTarget = path.join(root, 'node_modules', 'other-package', 'fonts.css')
        fs.mkdirSync(path.dirname(importer), { recursive: true })
        fs.writeFileSync(
            importer,
            '@import "vite-plugin-google-fonts/fonts.css";',
        )

        expect(
            hasStylesheetImport(root, target, {
                importSpecifierTargets: {
                    'vite-plugin-google-fonts/fonts.css': target,
                },
            }),
        ).toBe(true)
        expect(
            hasStylesheetImport(root, target, {
                importSpecifierTargets: {
                    'vite-plugin-google-fonts/fonts.css': otherTarget,
                },
            }),
        ).toBe(false)
    })

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

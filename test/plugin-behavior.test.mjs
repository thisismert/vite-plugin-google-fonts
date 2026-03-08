import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import googleFonts from '../src/plugin.js'

function createTempProject() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'vite-google-fonts-'))
}

function createResolvedConfig(root) {
    return {
        root,
        command: 'serve',
        base: '/',
        logger: { info: vi.fn() },
    }
}

describe('plugin entry discovery', () => {
    const tempDirs = []

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('ignores index.html and uses standard fallback entries', () => {
        const root = createTempProject()
        tempDirs.push(root)

        fs.mkdirSync(path.join(root, 'src'), { recursive: true })
        fs.writeFileSync(
            path.join(root, 'index.html'),
            '<!doctype html><html><body><script type="module" src="/src/bootstrap.tsx"></script></body></html>',
        )
        fs.writeFileSync(path.join(root, 'src', 'main.tsx'), 'export const main = true\n')
        fs.writeFileSync(path.join(root, 'src', 'bootstrap.tsx'), 'export const bootstrap = true\n')

        const [corePlugin, cssInjectPlugin] = googleFonts({
            fonts: {
                Inter: {},
            },
        })

        corePlugin.configResolved(createResolvedConfig(root))

        const transformed = cssInjectPlugin.transform('export const main = true\n', path.join(root, 'src', 'main.tsx'))
        expect(transformed.code).toContain("import '/")
        expect(transformed.code).toContain('google-fonts-injected')

        const untouched = cssInjectPlugin.transform('export const bootstrap = true\n', path.join(root, 'src', 'bootstrap.tsx'))
        expect(untouched).toBeNull()
    })

    it('prefers explicitly configured entries', () => {
        const root = createTempProject()
        tempDirs.push(root)

        fs.mkdirSync(path.join(root, 'src'), { recursive: true })
        fs.writeFileSync(path.join(root, 'src', 'main.tsx'), 'export const main = true\n')
        fs.writeFileSync(path.join(root, 'src', 'bootstrap.tsx'), 'export const bootstrap = true\n')

        const [corePlugin, cssInjectPlugin] = googleFonts({
            entry: 'src/bootstrap.tsx',
            fonts: {
                Inter: {},
            },
        })

        corePlugin.configResolved(createResolvedConfig(root))

        const transformed = cssInjectPlugin.transform('export const bootstrap = true\n', path.join(root, 'src', 'bootstrap.tsx'))
        expect(transformed.code).toContain('google-fonts-injected')

        const untouched = cssInjectPlugin.transform('export const main = true\n', path.join(root, 'src', 'main.tsx'))
        expect(untouched).toBeNull()
    })

    it('falls back to framework-specific entries when index.html is missing', () => {
        const root = createTempProject()
        tempDirs.push(root)

        fs.mkdirSync(path.join(root, 'src'), { recursive: true })
        fs.writeFileSync(
            path.join(root, 'package.json'),
            JSON.stringify({ dependencies: { '@tanstack/react-start': '^1.0.0' } }),
        )
        fs.writeFileSync(path.join(root, 'src', 'router.tsx'), 'export const router = true\n')

        const [corePlugin, cssInjectPlugin] = googleFonts({
            fonts: {
                Inter: {},
            },
        })

        corePlugin.configResolved(createResolvedConfig(root))

        const transformed = cssInjectPlugin.transform('export const router = true\n', path.join(root, 'src', 'router.tsx'))
        expect(transformed.code).toContain('google-fonts-injected')
    })

    it('throws when an explicit entry file does not exist', () => {
        const root = createTempProject()
        tempDirs.push(root)

        const [corePlugin] = googleFonts({
            entry: 'src/missing-entry.tsx',
            fonts: {
                Inter: {},
            },
        })

        expect(() => corePlugin.configResolved(createResolvedConfig(root))).toThrow(
            /Configured entry file was not found:/,
        )
    })
})
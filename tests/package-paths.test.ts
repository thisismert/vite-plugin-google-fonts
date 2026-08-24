import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPackageRoot } from '../src/package-paths.js'

let workspaceRoot: string

beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'google-fonts-paths-'))
})

afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('getPackageRoot', () => {
    it('uses the project-local package path', () => {
        const projectRoot = path.join(workspaceRoot, 'apps', 'web')
        const packageRoot = path.join(
            workspaceRoot,
            'node_modules',
            'vite-plugin-google-fonts',
        )
        fs.mkdirSync(projectRoot, { recursive: true })
        fs.mkdirSync(packageRoot, { recursive: true })
        fs.writeFileSync(
            path.join(packageRoot, 'package.json'),
            JSON.stringify({ name: 'vite-plugin-google-fonts' }),
        )

        expect(getPackageRoot(projectRoot)).toBe(packageRoot)
    })

    it('rejects projects without a physical package installation', () => {
        expect(() => getPackageRoot(workspaceRoot)).toThrow(
            'requires a writable node_modules installation',
        )
    })
})

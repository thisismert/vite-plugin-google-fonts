import fs from 'node:fs'
import path from 'node:path'

const PACKAGE_NAME = 'vite-plugin-google-fonts'
export const GENERATED_CSS_FILE_NAME = 'fonts.css'
export const GENERATED_CSS_IMPORT = 'vite-plugin-google-fonts/fonts.css'

function findInstalledPackageRoot(projectRoot: string): string | undefined {
    let current: string
    try {
        current = fs.realpathSync(projectRoot)
    } catch {
        current = path.resolve(projectRoot)
    }

    while (true) {
        const candidate = path.join(current, 'node_modules', PACKAGE_NAME)
        if (fs.existsSync(path.join(candidate, 'package.json'))) {
            return candidate
        }

        const parent = path.dirname(current)
        if (parent === current) {
            return undefined
        }

        current = parent
    }
}

export function getPackageRoot(projectRoot: string): string {
    const packageRoot = findInstalledPackageRoot(projectRoot)
    if (packageRoot) {
        return packageRoot
    }

    throw new Error(
        `Could not find a physical ${PACKAGE_NAME} installation under ${path.resolve(projectRoot)}. This plugin requires a writable node_modules installation to generate ${GENERATED_CSS_IMPORT}.`,
    )
}

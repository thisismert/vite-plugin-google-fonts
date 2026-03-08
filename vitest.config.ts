import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/**/*.test.{js,mjs,cjs,ts,mts,cts}'],
        exclude: ['test/types.test.ts'],
        typecheck: {
            enabled: true,
            include: ['test/types.test.ts'],
            tsconfig: './tsconfig.types.json',
        },
    },
})
import { defineConfig } from 'tsup'

export default defineConfig({
  clean: true,
  dts: false,
  entry: ['electron/main.ts', 'electron/preload.ts'],
  external: ['electron'],
  format: ['cjs'],
  outDir: 'dist-electron',
  outExtension() {
    return {
      js: '.cjs',
    }
  },
  sourcemap: false,
  splitting: false,
  target: 'node20',
})

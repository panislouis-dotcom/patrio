import { defineConfig } from 'vite'
import { resolve } from 'path'

// Bundle de UN solo propósito: darle al API el mismo `floorToSvg` que usa el editor, para
// que el prospecto no tenga una segunda implementación del plano que mantener sincronizada.
// IIFE porque el Chromium de Playwright lo carga con add_script_tag, sin módulos ni red —
// ver app/api/lib/plano_js.py.
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/lib/floorplan/planSheets.ts'),
      name: 'Plano',
      formats: ['iife'],
      fileName: () => 'plano.iife.js',
    },
    outDir: 'dist-plano',
    emptyOutDir: true,
    target: 'es2020',
  },
})

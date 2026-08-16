import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Los `.env` viven en la RAÍZ del repo, junto a los del API y los de compose —
  // uno solo por entorno, no uno por capa. Sin esto Vite los busca aquí (su
  // propia raíz), no encuentra nada, y `VITE_API_BASE` se queda sin definir: el
  // front cae al `?? 'http://localhost:8000'` de `lib/api.ts` y le pega a
  // CUALQUIER API que tenga ese puerto — el de otro worktree, típicamente. No
  // falla: funciona contra el backend equivocado, que es peor, porque la
  // pantalla es la tuya y las respuestas son de otro.
  //
  // Solo se exponen las variables con prefijo `VITE_`; los secretos que
  // comparten ese archivo (JWT, llaves, credenciales de BD) nunca entran al
  // bundle.
  envDir: '../..',
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
})

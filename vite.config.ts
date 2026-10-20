import { defineConfig } from 'vite'

// Relative Pfade, damit die App unter https://lulkasss.github.io/Minecraft-Buildings/ und lokal läuft.
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
})

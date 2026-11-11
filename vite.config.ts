import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  // ffmpeg.wasm spawns its own module worker, which esbuild pre-bundling breaks.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] },
})

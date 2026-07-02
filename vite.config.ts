import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://api.geminigen.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/api-snapgen': {
        target: 'https://api.snapgen.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-snapgen/, ''),
      },
    },
  },
})


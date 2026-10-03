import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The API runs on :8080. Proxying keeps everything same-origin, which is what lets the
// session cookie be SameSite=Lax + httpOnly with no CORS at all.
const api = { target: 'http://localhost:8080', xfwd: true }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': api,
      '/oauth2': api,
      '/login/oauth2': api,
    },
  },
})

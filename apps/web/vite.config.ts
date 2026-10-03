import tailwindcss from '@tailwindcss/vite'
import mdx from '@mdx-js/rollup'
import react from '@vitejs/plugin-react'
import remarkGfm from 'remark-gfm'
import { defineConfig } from 'vite'

// The API runs on :8080. Proxying keeps everything same-origin, which is what lets the
// session cookie be SameSite=Lax + httpOnly with no CORS at all.
const api = { target: 'http://localhost:8080', xfwd: true }

export default defineConfig({
  plugins: [mdx({ remarkPlugins: [remarkGfm] }), react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        // libraries change far less often than the app: separate chunks stay cached across deploys
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'motion', test: /node_modules[\\/](motion|motion-dom|motion-utils|framer-motion)[\\/]/ },
          ],
        },
      },
    },
  },
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

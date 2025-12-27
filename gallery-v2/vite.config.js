import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Plugin to serve /assets from parent directory during development
function serveAssetsPlugin() {
  return {
    name: 'serve-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url.startsWith('/assets/')) {
          const filePath = path.join(__dirname, '..', req.url)

          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase()
            const mimeTypes = {
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.gif': 'image/gif',
              '.webp': 'image/webp',
              '.svg': 'image/svg+xml',
            }

            res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream')
            res.setHeader('Cache-Control', 'public, max-age=31536000')
            fs.createReadStream(filePath).pipe(res)
            return
          }
        }
        next()
      })
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    serveAssetsPlugin(), // Serve assets from parent dir in dev mode
    // Copy shared assets from root /assets folder to dist/assets during build
    viteStaticCopy({
      targets: [
        {
          src: '../assets/commissions',
          dest: 'assets'
        },
        {
          src: '../assets/referencesheets',
          dest: 'assets'
        }
      ]
    })
  ],

  // Development server configuration
  server: {
    fs: {
      // Allow serving files from parent directory
      allow: ['..']
    }
  },

  // Define public directory for dev server
  publicDir: 'public'
})

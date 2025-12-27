import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
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
  // Base path for production (app is served from root /)
  base: '/',

  plugins: [
    react(),
    serveAssetsPlugin(), // Serve assets from parent dir in dev mode
    // NOTE: Assets are NOT copied during build
    // They are synced separately to VPS at /var/www/cuddlebuns/public/assets/
    // This keeps the build output clean and allows shared /assets folder
  ],

  // Build configuration
  build: {
    // Use 'static' for Vite's built JS/CSS files
    // This prevents conflict with /assets/ (which is for images)
    assetsDir: 'static',
    // Output directory
    outDir: 'dist',
  },

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

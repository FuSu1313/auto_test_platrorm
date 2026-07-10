import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// SPA fallback: 将非 API、非静态资源请求回退到 index.html，支持前端路由
function spaFallback() {
  return {
    name: 'spa-fallback',
    configureServer(server) {
      return () => {
        server.middlewares.use((req, _res, next) => {
          const isApi = req.url.startsWith('/api/')
          const isAsset = /\.[a-zA-Z0-9]+$/.test(req.url)
          if (!isApi && !isAsset && req.url !== '/') {
            req.url = '/'
          }
          next()
        })
      }
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), spaFallback()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  }
})

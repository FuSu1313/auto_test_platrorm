import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// SPA fallback: 将非 API、非静态资源请求回退到 index.html，支持前端路由
// 注意：直接调用 server.middlewares.use() 而不是 return () => {}，
// 确保中间件在 Vite 内部中间件（含 404 兜底）之前执行
function spaFallback() {
  return {
    name: 'spa-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url
        // 不拦截 API 代理请求
        if (url.startsWith('/api/')) return next()
        // 不拦截 Vite 内部请求
        if (url.startsWith('/@')) return next()
        // 不拦截带文件扩展名的静态资源请求
        if (/\.[a-zA-Z0-9]+$/.test(url)) return next()
        // 不拦截根路径
        if (url === '/') return next()
        // 其余走 SPA，重写到 / 返回 index.html
        req.url = '/'
        next()
      })
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

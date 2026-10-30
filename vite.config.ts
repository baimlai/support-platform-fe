import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// 开发期默认把 /api 转发到本地 FastAPI，避免浏览器跨域配置。
// 如果后端不在 8000 端口，复制 .env.example 为 .env 并修改 VITE_API_PROXY_TARGET。
//
// 这里用 loadEnv 而不是直接读 process.env：
// 1. 能同时读到 .env 文件和系统环境变量；
// 2. tsconfig 里没有引入 Node 类型（页面代码也不需要），直接写 process 会编译报错。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
  }
})

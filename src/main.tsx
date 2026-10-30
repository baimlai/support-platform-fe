/**
 * 应用入口。
 *
 * Vite 会把 index.html 里的 <script type="module" src="/src/main.tsx"> 当作入口，
 * 从这里挂载 React 根组件。
 *
 * 这里做两件事：
 * 1. 找到 index.html 里的 #root 容器；
 * 2. 用 createRoot 渲染 <App />。
 *
 * 如果 #root 不存在，说明 index.html 被改坏了，直接抛错比默默白屏更容易排查。
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// getElementById 的返回类型是 HTMLElement | null，所以先判断再使用。
const container = document.getElementById('root')
if (!container) {
  throw new Error('找不到 #root 容器，请检查 index.html')
}

/**
 * StrictMode 在开发环境会故意重复执行一些生命周期/Effect，用来帮助发现副作用问题。
 * 本项目所有请求都带 AbortController 清理，重复执行不会留下重复轮询。
 */
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

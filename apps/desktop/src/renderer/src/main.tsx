import { ErrorBoundary } from './components/ErrorBoundary'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyThemeClass, prefersDark } from './lib/theme'
import './styles/index.css'

// 挂载之前先把主题类挂上。主进程在建窗口之前就定好了 themeSource，
// 所以此刻的媒体查询就是准的 —— 晚一步会先渲染出一帧浅色。
applyThemeClass(prefersDark())

const container = document.getElementById('root')
if (!container) {
  throw new Error('找不到 #root 挂载点')
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
    <App />
    </ErrorBoundary>
  </StrictMode>
)

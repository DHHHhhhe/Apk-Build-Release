import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * 渲染层兜底。
 *
 * 未捕获的渲染错误会把整棵树卸掉 —— 用户看到的是一片白，只能重开。这里兜住，
 * 给一句话、一个「重新加载界面」按钮，以及错误原文（用户来反馈时能直接贴出来）。
 *
 * 与参考实现同一套做法：类组件 + `getDerivedStateFromError` 决定降级 UI，
 * `componentDidCatch` 只负责记录。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 降级界面之外再留一份记录：用户来反馈时对得上
    console.error('[render] 界面渲染失败', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }
    return (
      <div className="app-crash" role="alert">
        <p className="app-crash__title">
          <TriangleAlert size={16} aria-hidden="true" />
          界面出错了
        </p>
        <p className="app-crash__hint">
          正在跑的构建任务不受影响，但这一页已经没法继续操作。重新加载界面通常就能恢复；如果每次打开都这样，把下面这段发出来。
        </p>
        <pre className="app-crash__detail">{`${error.name}: ${error.message}`}</pre>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            window.location.reload()
          }}
        >
          重新加载界面
        </button>
      </div>
    )
  }
}
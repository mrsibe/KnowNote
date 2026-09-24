import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18n from '../../i18n'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  error: Error | null
}

/**
 * 顶层错误边界。
 *
 * 没有它时，任何渲染期异常都会让 React 卸载整棵组件树，窗口直接变白，用户和日志都
 * 拿不到线索。这里把异常收敛成一个可恢复的错误页，并把原始错误写进控制台。
 *
 * 用 i18n 实例而不是 useTranslation：错误页必须能在 React 上下文之外渲染。
 */
export default class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AppErrorBoundary] Uncaught render error:', error, info.componentStack)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface-base p-8 text-center text-foreground">
        <h1 className="text-lg font-medium">{i18n.t('common:errorTitle')}</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {i18n.t('common:errorDescription')}
        </p>
        <pre className="max-w-md overflow-auto rounded-md border border-border bg-surface-sunken p-3 text-left text-xs text-subtle-foreground">
          {error.message}
        </pre>
        <button
          type="button"
          onClick={this.handleReload}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-hover"
        >
          {i18n.t('common:reload')}
        </button>
      </div>
    )
  }
}

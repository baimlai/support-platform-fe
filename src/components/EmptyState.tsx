/**
 * 通用空状态。
 *
 * 页面里很多地方会出现“后端没返回数据”的情况：
 * - 样例列表为空；
 * - 任务还没产生轮次；
 * - Topic 还没生成；
 * - 报告还没生成；
 * - 证据列表为空。
 *
 * 统一用这个组件显示，避免每个页面各写一套，也保证“空”和“错误”看起来不一样。
 */

import type { ReactNode } from 'react'
import { classNames } from '../utils/format'

interface EmptyStateProps {
  /** 主标题，例如“暂无轮次事件”。 */
  title: string
  /** 补充说明，解释为什么为空、用户可以做什么。 */
  description?: string
  /** 图标，传一个 JSX 元素即可，例如 <DatabaseIcon />。 */
  icon?: ReactNode
  /** 操作区，例如“重新加载”按钮。 */
  action?: ReactNode
  /** error 用红色调，提示这是失败而不是普通的空数据。 */
  tone?: 'neutral' | 'error'
  /** 允许调用方追加 class，方便布局。 */
  className?: string
}

/**
 * 组件参数使用解构：
 *
 *   function EmptyState({ title, description }: EmptyStateProps)
 *
 * 等价于：
 *
 *   function EmptyState(props: EmptyStateProps) {
 *     const title = props.title
 *     const description = props.description
 *   }
 *
 * 解构写起来更短，也能在参数列表里直接看到组件需要什么。
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  tone = 'neutral',
  className,
}: EmptyStateProps) {
  return (
    <div className={classNames('empty-state', `empty-state--${tone}`, className)}>
      {icon ? <div className="empty-state__icon">{icon}</div> : null}
      <div className="empty-state__title">{title}</div>
      {description ? <div className="empty-state__description">{description}</div> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  )
}

/**
 * 行内提示条，用于“后端错误 / 报告未生成 / 404”等。
 *
 * 和 EmptyState 的区别：
 * - EmptyState 占一整块区域，适合面板内容为空；
 * - Notice 更紧凑，适合放在面板顶部或表单下面。
 */
interface NoticeProps {
  tone?: 'info' | 'warning' | 'error'
  children: ReactNode
}

export function Notice({ tone = 'info', children }: NoticeProps) {
  return (
    <div className={classNames('notice', `notice--${tone}`)} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  )
}

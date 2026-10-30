/**
 * ============================================================================
 * 运行概览（任务头部）
 * ============================================================================
 *
 * 展示当前任务的“身份证”和运行状态：
 * - 工单标题；
 * - 任务状态、当前轮次、停止原因；
 * - 任务 ID（可复制）；
 * - 轮询/错误提示；
 * - 刷新、取消按钮；
 * - 原始工单内容（折叠）。
 *
 * 这里不展示“预计剩余时间”之类的推测信息，因为后端没有给，前端不能编。
 *
 * 显示约定：
 * - 任务状态、轮次、停止原因都以后端返回为准；
 * - 取消按钮只在 queued / pending / running 时出现；
 * - 任务 ID 支持复制，方便排查和重新打开。
 */

import { useState } from 'react'
import type { ModelsView, TaskDetail } from '../api/types'
import { ticketText, ticketTitle } from '../api/normalize'
import { StatusBadge } from './StatusBadge'
import { AlertIcon, CopyIcon, RefreshIcon, StopIcon } from './icons'
import { Notice } from './EmptyState'
import { copyText, shortId } from '../utils/format'

interface RunHeaderProps {
  taskId: string
  task: TaskDetail | null
  /**
   * 模型列表，只用来把 provider 标识翻译成人类可读的 label。
   *
   * 注意：它不参与“这个任务用了什么模型”的判断。
   * 任务实际使用的模型来自 task.model_provider / task.model_name 快照。
   */
  models?: ModelsView | null
  /** 首次加载任务详情中。 */
  loading: boolean
  /** 是否还在轮询。 */
  polling: boolean
  /** 轮询/取消产生的错误。 */
  error: string | null
  /** 是否正在请求取消。 */
  cancelling: boolean
  onCancel: () => void | Promise<void>
  onRefresh: () => void
}

/**
 * 停止原因的中文说明。
 *
 * `Record<string, string>` 的意思是“键是字符串，值是字符串”。
 * 如果后端返回了表里没有的原因，就原样显示，方便联调时发现新值。
 */
const STOP_REASON_LABEL: Record<string, string> = {
  completed: '正常完成',
  max_turns: '达到最大轮次',
  max_steps: '达到最大步数',
  cancelled: '用户取消',
  canceled: '用户取消',
  error: '执行错误',
  interrupted: '进程中断',
  timeout: '执行超时',
}

function stopReasonLabel(reason: string | null | undefined): string {
  if (!reason) return '—'
  return STOP_REASON_LABEL[reason.toLowerCase()] ?? reason
}

export function RunHeader({
  taskId,
  task,
  models,
  loading,
  polling,
  error,
  cancelling,
  onCancel,
  onRefresh,
}: RunHeaderProps) {
  const [copied, setCopied] = useState(false)

  /**
   * 只有排队中/运行中的任务才允许取消。
   *
   * 注意 `task.status` 可能来自后端的新状态；这里用数组 includes 判断，
   * 不在列表里的状态一律不显示取消按钮，避免对已完成任务发取消请求。
   */
  const canCancel =
    task !== null && ['queued', 'pending', 'running'].includes(task.status.toLowerCase())

  /*
    `ticketTitle(task?.ticket)`：
    task 还没加载时 `task?.ticket` 是 undefined，函数内部会做空值处理，返回 ''。
    后面的 `||` 再兜底成“任务 + 短 ID”，保证标题永远不会是空白。

    `shortId(taskId)` 只截断显示，不会改变真正用于请求的任务 ID。
  */
  const title = ticketTitle(task?.ticket) || `任务 ${shortId(taskId)}`
  const rawTicket = ticketText(task?.ticket)

  /*
    模型展示只读任务快照（task.model_provider / task.model_name）。
    千万不要写：
      modelLabel = 当前表单里选中的模型
    因为用户打开一个历史任务时，表单里可能已经切到别的模型，
    拿它回填会让用户误以为旧任务也是用新模型跑的。

    provider 优先显示 /api/models 里的 label（例如 DeepSeek），
    label 拿不到就退回原始标识（例如 deepseek）。
  */
  const providerView = models?.providers.find((item) => item.provider === task?.model_provider)
  const modelLabel =
    task?.model_provider || task?.model_name
      ? `${providerView?.label ?? task?.model_provider ?? '—'}${
          task?.model_name ? ` / ${task.model_name}` : ''
        }`
      : '—'

  const handleCopy = async () => {
    const ok = await copyText(taskId)
    setCopied(ok)
    // 1.5 秒后恢复按钮文字。即使组件卸载，这个 setTimeout 也只会尝试 setState，
    // React 18+ 不会再报“组件已卸载”的警告；这里保留是为了交互反馈。
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="run-header panel">
      <div className="run-header__top">
        <div className="run-header__title-block">
          <div className="run-header__eyebrow">
            <span>运行概览</span>
            {polling ? (
              <span className="live-indicator">
                <span className="live-indicator__dot" aria-hidden="true" />
                轮询中
              </span>
            ) : null}
          </div>
          <h1 className="run-header__title">{title}</h1>
          <div className="run-header__meta">
            {task ? (
              <StatusBadge status={task.status} />
            ) : loading ? (
              <span className="badge badge--neutral">
                <span className="badge__dot" aria-hidden="true" />
                读取中
              </span>
            ) : (
              <StatusBadge status="unknown" />
            )}

            <span className="run-header__meta-item">
              当前轮次 <strong>{task?.current_turn ?? '—'}</strong>
            </span>
            <span className="run-header__meta-item">
              停止原因 <strong>{stopReasonLabel(task?.stop_reason)}</strong>
            </span>
            <span className="run-header__meta-item">
              本次模型 <strong>{modelLabel}</strong>
            </span>
          </div>
        </div>

        <div className="run-header__actions">
          <button type="button" className="button button--ghost" onClick={onRefresh}>
            <RefreshIcon size={14} />
            刷新
          </button>
          {canCancel ? (
            <button
              type="button"
              className="button button--danger"
              onClick={() => void onCancel()}
              disabled={cancelling}
            >
              <StopIcon size={14} />
              {cancelling ? '正在取消…' : '取消任务'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="run-header__id-row">
        <span className="run-header__id-label">任务 ID</span>
        <code className="run-header__id" title={taskId}>
          {taskId}
        </code>
        <button type="button" className="icon-button" onClick={() => void handleCopy()} title="复制任务 ID">
          <CopyIcon size={14} />
        </button>
        {copied ? <span className="run-header__copied">已复制</span> : null}
      </div>

      {/* 任务级错误：后端执行失败时 task.error 会有内容。 */}
      {task?.error ? (
        <Notice tone="error">
          <span className="notice__icon">
            <AlertIcon size={15} />
          </span>
          任务错误：{task.error}
        </Notice>
      ) : null}

      {/* 轮询/取消错误：后端没启动、网络断开、404 等。 */}
      {error ? (
        <Notice tone="error">
          <span className="notice__icon">
            <AlertIcon size={15} />
          </span>
          {error}
        </Notice>
      ) : null}

      {rawTicket ? (
        <details className="run-header__ticket">
          <summary>查看原始工单</summary>
          <pre>{rawTicket}</pre>
        </details>
      ) : null}
    </section>
  )
}

/**
 * ============================================================================
 * 状态徽标
 * ============================================================================
 *
 * 同一个 status 字符串在任务、轮次、工具三种场景下含义不同，所以用 kind 区分。
 * 例如 "completed" 在任务里是“已完成”，工具里更常说“成功”。
 *
 * 显示约定：
 * - 已知状态显示中文标签；
 * - 未知状态原样显示后端字符串，方便联调时发现新增状态，不伪装成“未知”；
 * - 任务、轮次、工具分别查各自的映射表，避免同一个英文词在不同场景下显示错。
 */

import { classNames } from '../utils/format'

/** 徽标用于哪种场景。 */
type BadgeKind = 'task' | 'turn' | 'tool'

interface StatusBadgeProps {
  /** 后端返回的状态字符串；可能为 null 或 undefined。 */
  status: string | null | undefined
  /** 不传时默认按任务状态处理。 */
  kind?: BadgeKind
}

/**
 * 徽标的显示信息。
 *
 * `tone` 用字面量联合类型限制，只能取这六种之一。
 * 这样 CSS 里只需要准备六种颜色，组件不会传出一个没定义过的 tone。
 */
interface BadgeMeta {
  label: string
  tone: 'neutral' | 'running' | 'success' | 'danger' | 'warning' | 'info'
}

/** 任务状态映射。 */
const TASK_STATUS: Record<string, BadgeMeta> = {
  queued: { label: '排队中', tone: 'neutral' },
  pending: { label: '等待中', tone: 'neutral' },
  running: { label: '运行中', tone: 'running' },
  completed: { label: '已完成', tone: 'success' },
  succeeded: { label: '已完成', tone: 'success' },
  success: { label: '已完成', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  error: { label: '错误', tone: 'danger' },
  cancelled: { label: '已取消', tone: 'warning' },
  canceled: { label: '已取消', tone: 'warning' },
  timeout: { label: '超时', tone: 'warning' },
  interrupted: { label: '已中断', tone: 'neutral' },
  unknown: { label: '未知', tone: 'neutral' },
}

/**
 * 轮次状态映射。
 *
 * 注意 completed 显示“本轮结束”，不是“已完成”。
 * 后端的 turn_end 只表示“这一轮模型响应结束了”，
 * 后面还可能继续下一轮、继续调工具；整个任务是否结束要看任务状态或 agent_end。
 * 如果这里写“已完成”，用户容易误以为整个调查已经结束。
 */
const TURN_STATUS: Record<string, BadgeMeta> = {
  running: { label: '进行中', tone: 'running' },
  requested: { label: '已请求', tone: 'info' },
  completed: { label: '本轮结束', tone: 'success' },
  succeeded: { label: '本轮结束', tone: 'success' },
  success: { label: '本轮结束', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  error: { label: '错误', tone: 'danger' },
  cancelled: { label: '已取消', tone: 'warning' },
  canceled: { label: '已取消', tone: 'warning' },
  timeout: { label: '超时', tone: 'warning' },
  unknown: { label: '状态未知', tone: 'neutral' },
}

/** 工具状态映射。注意 no_data 单独一种，不能合并到成功或失败。 */
const TOOL_STATUS: Record<string, BadgeMeta> = {
  requested: { label: '已请求', tone: 'info' },
  running: { label: '执行中', tone: 'running' },
  ok: { label: '成功', tone: 'success' },
  success: { label: '成功', tone: 'success' },
  succeeded: { label: '成功', tone: 'success' },
  no_data: { label: '无数据', tone: 'info' },
  empty: { label: '无数据', tone: 'info' },
  error: { label: '失败', tone: 'danger' },
  failed: { label: '失败', tone: 'danger' },
  timeout: { label: '超时', tone: 'warning' },
  timed_out: { label: '超时', tone: 'warning' },
  blocked: { label: '已阻止', tone: 'warning' },
  denied: { label: '已阻止', tone: 'warning' },
  cancelled: { label: '已取消', tone: 'warning' },
  canceled: { label: '已取消', tone: 'warning' },
  invalid_arguments: { label: '参数错误', tone: 'danger' },
  unknown: { label: '未知', tone: 'neutral' },
}

/**
 * 查表。
 *
 * 参数类型 `string | null | undefined` 表示调用方可能还没拿到状态。
 * 先把 status 转小写，再查对应的表；找不到就返回一个兜底对象。
 *
 * 注意：后端原始状态会显示在界面上（例如 'paused'），
 * 不会因为不认识就假装成 'unknown'。这样联调时能一眼看到后端新增了什么状态。
 */
function metaFor(kind: BadgeKind, status: string | null | undefined): BadgeMeta {
  const key = (status ?? 'unknown').toLowerCase()
  const table = kind === 'task' ? TASK_STATUS : kind === 'turn' ? TURN_STATUS : TOOL_STATUS
  return table[key] ?? { label: status ?? '未知', tone: 'neutral' }
}

/**
 * 状态徽标组件。
 *
 * `title={status ?? undefined}`：
 * - title 是鼠标悬停时的原生提示；
 * - 如果 status 是 null，就传 undefined，不显示提示。
 */
export function StatusBadge({ status, kind = 'task' }: StatusBadgeProps) {
  const meta = metaFor(kind, status)

  return (
    <span className={classNames('badge', `badge--${meta.tone}`)} title={status ?? undefined}>
      <span className="badge__dot" aria-hidden="true" />
      {meta.label}
    </span>
  )
}

/**
 * 只取状态的中文标签，不渲染徽标。
 * 例如页面里想写“已完成（stop_reason=completed）”时可以用它。
 *
 * 默认参数 `kind: BadgeKind = 'task'` 让调用方可以只传 status。
 */
export function statusLabel(status: string | null | undefined, kind: BadgeKind = 'task'): string {
  return metaFor(kind, status).label
}

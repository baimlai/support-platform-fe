/**
 * ============================================================================
 * 单个工具调用卡片
 * ============================================================================
 *
 * 展示一次工具调用的完整信息：
 * - 工具名、状态、耗时；
 * - 入参（可折叠）；
 * - 结果预览（有界，不把大结果整块塞进页面）；
 * - 证据引用按钮（打开有界预览抽屉）。
 *
 * 状态显示原则：
 * - no_data：工具成功执行，但没查到数据 —— 不是失败；
 * - error：执行失败；
 * - timeout：超时；
 * - blocked：被权限/安全策略阻止；
 * - invalid_arguments：模型给的参数不合法；
 * - cancelled：任务被取消；
 * 这些状态必须分开显示，不能统一写成“无异常”。
 */

import type { ToolCallView } from '../api/types'
import { formatDuration, prettyJson } from '../utils/format'
import { StatusBadge } from './StatusBadge'
import { FileIcon } from './icons'

interface ToolCallCardProps {
  call: ToolCallView
  /** 点击证据引用时，由父组件打开证据抽屉。 */
  onOpenEvidence: (evidenceId: string) => void
}

/**
 * 根据状态给出额外说明。
 *
 * 返回 `string | null`：
 * - 有说明就返回字符串；
 * - 正常成功（ok）或不需要说明时返回 null。
 */
function statusHint(call: ToolCallView): string | null {
  switch (call.status) {
    case 'running':
      return '工具正在执行，结果返回后会自动更新。'
    case 'no_data':
      return '工具执行成功，但没有查到数据。这与“工具失败”不同。'
    case 'error':
      return '工具执行失败。请查看错误信息或后端日志。'
    case 'timeout':
      return '工具执行超时，结果可能不完整。'
    case 'blocked':
      return '工具调用被安全策略阻止，未执行。'
    case 'cancelled':
      return '任务被取消，工具调用没有完成。'
    case 'invalid_arguments':
      return '模型给出的参数不合法，工具未执行或执行失败。'
    default:
      return null
  }
}

export function ToolCallCard({ call, onOpenEvidence }: ToolCallCardProps) {
  const hint = statusHint(call)

  /**
   * 结果预览优先用后端/归一化层给的 result_preview；
   * 如果没有，就把 result 格式化成 JSON。
   *
   * 注意：result 可能是一个非常大的对象，normalize.ts 已经把 preview 截断到 4000 字符。
   * 这里再兜底是为了兼容某些只给 result、不给 preview 的后端。
   */
  /*
    `??` 和 `||` 的区别在这里很关键：
    - `??` 只在左侧是 null/undefined 时才取右边；
    - 如果 result_preview 是空字符串 ''，`??` 会保留空字符串，
      而 `||` 会错误地跳到 result 分支。
    结果为空时页面会显示“后端未返回结果内容”，所以保留空字符串是有意义的。
  */
  const resultText =
    call.result_preview ??
    (call.result !== undefined && call.result !== null ? prettyJson(call.result) : '')

  return (
    <article className="tool-card">
      <div className="tool-card__header">
        <div className="tool-card__name">
          <span className="tool-card__icon" aria-hidden="true">
            <FileIcon size={15} />
          </span>
          <code>{call.tool_name}</code>
        </div>
        <div className="tool-card__status">
          <StatusBadge status={call.status} kind="tool" />
          <span className="tool-card__duration">{formatDuration(call.duration_ms)}</span>
        </div>
      </div>

      {hint ? <div className={`tool-card__hint tool-card__hint--${call.status}`}>{hint}</div> : null}

      {call.args !== undefined && call.args !== null ? (
        <details className="tool-card__section">
          <summary>入参</summary>
          <pre>{prettyJson(call.args)}</pre>
        </details>
      ) : null}

      {/*
        <details open={...}> 控制默认展开：
        - 错误或参数不合法时默认展开，让用户一眼看到问题；
        - 正常结果默认折叠，保持页面紧凑。
        open 是布尔属性，传 false 就是不展开。
      */}
      {resultText ? (
        <details className="tool-card__section" open={call.status === 'error' || call.status === 'invalid_arguments'}>
          <summary>结果预览</summary>
          <pre>{resultText}</pre>
          {call.raw_ref ? (
            <button
              type="button"
              className="button button--ghost button--small tool-card__evidence"
              /*
                这里写 `call.raw_ref as string` 是因为 onClick 是回调函数：
                TypeScript 不会把外面的 `call.raw_ref ?` 判断带进回调内部，
                回调执行时它仍认为 raw_ref 可能是 undefined。
                `as string` 是类型断言，告诉编译器“这里一定是字符串”。
                运行时安全，因为按钮只有在 raw_ref 存在时才渲染。
              */
              onClick={() => onOpenEvidence(call.raw_ref as string)}
            >
              <FileIcon size={14} />
              查看原始证据 {call.raw_ref}
            </button>
          ) : null}
        </details>
      ) : call.status === 'running' ? (
        <div className="tool-card__pending">等待工具返回结果…</div>
      ) : (
        <div className="tool-card__pending">后端未返回结果内容。</div>
      )}

      {/* 有些后端把结果放在 result 以外的字段，raw_ref 仍然可能单独出现。 */}
      {call.raw_ref && !resultText ? (
        <button
          type="button"
          className="button button--ghost button--small tool-card__evidence"
          onClick={() => onOpenEvidence(call.raw_ref as string)}
        >
          <FileIcon size={14} />
          查看原始证据 {call.raw_ref}
        </button>
      ) : null}
    </article>
  )
}

/**
 * ============================================================================
 * 单轮详情
 * ============================================================================
 *
 * 展示选中轮次的完整内容：
 * - 助手输出；
 * - 本轮所有工具调用（入参、结果预览、证据引用）；
 * - “本轮上下文”按需加载（只有用户点开时才请求后端）。
 *
 * 为什么上下文要按需加载？
 * 一轮的上下文可能包含完整消息历史、工具定义、预算信息，体积不小。
 * 页面一打开就全部加载会浪费带宽和内存，所以这里用按钮控制。
 *
 * 加载约定：
 * - useTurnContext 始终调用，但只有展开时传入真实参数；
 * - 切换轮次会重新请求，旧请求由 Hook 内部中止；
 * - 上下文内容只放在可滚动区域里，避免撑破页面。
 */

import { useState } from 'react'
import type { TurnView } from '../api/types'
import { useTurnContext } from '../api/useTurnContext'
import { formatDateTime, prettyJson } from '../utils/format'
import { EmptyState, Notice } from './EmptyState'
import { StatusBadge } from './StatusBadge'
import { ToolCallCard } from './ToolCallCard'
import { ChevronIcon } from './icons'

interface TurnDetailProps {
  taskId: string
  /** 当前选中的轮次；没有选中时为 null。 */
  turn: TurnView | null
  onOpenEvidence: (evidenceId: string) => void
}

export function TurnDetail({ taskId, turn, onOpenEvidence }: TurnDetailProps) {
  /** 控制“本轮上下文”折叠区是否展开，初始收起，避免一进页面就发请求。 */
  const [contextOpen, setContextOpen] = useState(false)

  /**
   * 只有展开并且有选中轮次时，才把真实参数传给 Hook。
   * 否则传 null，Hook 会清空状态且不发请求。
   *
   * `turn !== null` 之后再访问 turn.turn 是安全的；
   * 这里用 `turn ? turn.turn : null` 是为了让类型更直观。
   *
   * 注意：Hook 必须无条件调用，不能写成：
   *   if (contextOpen) { useTurnContext(...) }   // 错误！
   * React 要求每次渲染 Hook 的调用顺序一致。所以这里始终调用
   * useTurnContext，只是用 null 参数告诉它“现在不需要请求”。
   */
  const contextTaskId = contextOpen ? taskId : null
  const contextTurn = contextOpen && turn ? turn.turn : null

  /**
   * 解构时重命名：
   *   loading: contextLoading
   * 意思是“把返回值里的 loading 取出来，但在当前作用域叫 contextLoading”。
   * 这样和组件里其他 loading 变量区分开，读代码时一眼知道它属于上下文请求。
   */
  const {
    context,
    loading: contextLoading,
    error: contextError,
    notFound: contextNotFound,
  } = useTurnContext(contextTaskId, contextTurn)

  /*
    没有选中轮次时提前返回空状态。
    这个 return 必须放在所有 Hook 调用之后：如果放在 useTurnContext
    之前，某些渲染会跳过 Hook，React 会报“Hook 顺序不一致”。
  */
  if (!turn) {
    return (
      <section className="panel turn-detail">
        <div className="panel__header">
          <div>
            <div className="panel__eyebrow">轮次</div>
            <h2 className="panel__title">轮次详情</h2>
          </div>
        </div>
        <EmptyState
          title="还没有选中轮次"
          description="在左侧时间线点击某一轮，这里会显示该轮的模型输出、工具调用和上下文。"
        />
      </section>
    )
  }

  return (
    <section className="panel turn-detail">
      <div className="panel__header">
        <div>
          <div className="panel__eyebrow">轮次 {turn.turn}</div>
          <h2 className="panel__title">第 {turn.turn} 轮详情</h2>
        </div>
        <StatusBadge status={turn.status} kind="turn" />
      </div>

      <div className="turn-detail__meta">
        <span>开始：{turn.started_at ? formatDateTime(turn.started_at) : '未返回'}</span>
        <span>结束：{turn.ended_at ? formatDateTime(turn.ended_at) : '进行中/未返回'}</span>
        <span>事件：{turn.event_count}</span>
        {/*
          这里写“模型响应事件”，不是“模型响应”。
          原因：后端当前只把 model_request / model_response 写进运行日志，
          不通过事件流返回；所以很多轮明明有助手输出，
          model_response_seen 仍然是 false。
          直接写“未返回”会让用户以为模型没响应，属于误导。
          页面只陈述“事件流里有没有这类事件”，不推断模型有没有工作。
        */}
        <span>模型响应事件：{turn.model_response_seen ? '已记录' : '未记录'}</span>
        {/*
          写“响应停止原因”而不是“停止原因”：
          这个值来自 message.stop_reason，例如 toolUse 表示
          “模型这一轮先停下，等工具结果后继续”，不是整个任务停止。
        */}
        {turn.assistant_stop_reason ? (
          <span>响应停止原因：{turn.assistant_stop_reason}</span>
        ) : null}
      </div>

      <div className="turn-detail__section">
        <h3 className="section-title">助手输出</h3>
        {turn.assistant_text ? (
          <pre className="text-block">{turn.assistant_text}</pre>
        ) : (
          <div className="turn-detail__muted">
            {/*
              三种情况分开说，避免把“没有文本”误说成“模型没响应”：
              1. 看到过模型响应事件 -> 模型确实回了，只是没有文本；
              2. 本轮已结束但没看到响应事件 -> 事件流没有可展示文本；
              3. 本轮还在跑 -> 等待。
              `turn.ended_at` 是字符串或 undefined，可直接当布尔条件用。
            */}
            {turn.model_response_seen
              ? '模型这一轮没有返回文本内容。'
              : turn.ended_at
                ? '本轮已结束，但事件流里没有可展示的助手文本。'
                : '等待模型响应…'}
          </div>
        )}
      </div>

      <div className="turn-detail__section">
        <h3 className="section-title">
          工具调用
          <span className="section-title__count">{turn.tool_calls.length}</span>
        </h3>
        {/*
          工具调用列表。
          每个工具卡片用 tool_call_id 做 key：这是后端给每次调用的唯一 ID，
          比数组下标稳定，增量更新时不会错位。
        */}
        {turn.tool_calls.length === 0 ? (
          <div className="turn-detail__muted">本轮没有工具调用。</div>
        ) : (
          <div className="tool-list">
            {turn.tool_calls.map((call) => (
              <ToolCallCard key={call.tool_call_id} call={call} onOpenEvidence={onOpenEvidence} />
            ))}
          </div>
        )}
      </div>

      <div className="turn-detail__section">
        <div className="turn-detail__context-head">
          <h3 className="section-title">本轮上下文</h3>
          {/*
            函数式更新 `setContextOpen((open) => !open)`：
            React 把上一次的布尔值传进来，取反后作为新值。
            比 `setContextOpen(!contextOpen)` 更稳：连续快速点击时
            contextOpen 可能还是旧的，函数式更新总是基于最新值。
          */}
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => setContextOpen((open) => !open)}
          >
            <ChevronIcon size={14} direction={contextOpen ? 'down' : 'right'} />
            {contextOpen ? '收起' : '展开并加载'}
          </button>
        </div>

        <p className="turn-detail__hint">
          这里展示后端记录的这一轮实际上下文（消息、工具、预算）。只有在展开时才会请求
          <code> /turns/{turn.turn}/context</code>。
        </p>

        {contextOpen ? (
          <div className="context-box">
            {contextLoading ? <div className="turn-detail__muted">正在读取本轮上下文…</div> : null}

            {contextNotFound ? (
              <Notice tone="warning">
                后端没有返回这一轮的上下文（404）。可能是该轮还没开始，或后端未保存上下文。
              </Notice>
            ) : null}

            {contextError ? <Notice tone="error">上下文加载失败：{contextError}</Notice> : null}

            {context ? (
              <>
                <details className="context-section" open>
                  <summary>messages · {context.messages.length} 条</summary>
                  <pre>{prettyJson(context.messages)}</pre>
                </details>
                <details className="context-section">
                  <summary>tools · {context.tools.length} 个</summary>
                  <pre>{prettyJson(context.tools)}</pre>
                </details>
                <details className="context-section">
                  <summary>budget</summary>
                  <pre>{prettyJson(context.budget)}</pre>
                </details>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}

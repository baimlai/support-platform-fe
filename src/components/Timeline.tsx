/**
 * ============================================================================
 * 运行时间线
 * ============================================================================
 *
 * 时间线的数据不是后端直接给的 turns 数组，而是由 useTask 里的 deriveTurns()
 * 从事件流归并出来的。这样可以做到：
 * - 页面刷新后只靠事件就能恢复；
 * - 不需要后端额外提供“轮次列表”接口；
 * - 每个轮次里能看到工具调用、状态、耗时。
 *
 * 交互：
 * - 点击某一轮，右侧 TurnDetail 显示该轮详情；
 * - 运行中自动选中最新轮次（逻辑在 App 里）；
 * - 用户手动选旧轮次后，不会被新事件强行拉回。
 */

import type { TurnView } from '../api/types'
import { classNames, formatDateTime, truncateText } from '../utils/format'
import { EmptyState } from './EmptyState'
import { StatusBadge } from './StatusBadge'

/**
 * 时间线组件的参数。
 *
 * 这里出现了两种常见类型写法：
 * 1. `TurnView[]`：数组；
 * 2. `(turn: number) => void`：函数类型，表示“接收一个 number，不返回结果”。
 *
 * TypeScript 里函数也是值，可以像普通字段一样写进接口。
 * 这样调用方如果传了 `(turn: string) => ...`，编译器会立刻报错。
 */
interface TimelineProps {
  turns: TurnView[]
  selectedTurn: number | null
  onSelectTurn: (turn: number) => void
  /** 任务是否还在轮询；用于区分“还没开始”和“已经结束但没事件”。 */
  polling: boolean
}

/**
 * 解构 props 时，`onSelectTurn` 是父组件传下来的回调。
 * 子组件不直接改 `selectedTurn`，而是调用回调，让父组件决定怎么改。
 * 这叫“受控组件”思路：状态放在父组件，子组件只负责展示和发事件。
 */
export function Timeline({ turns, selectedTurn, onSelectTurn, polling }: TimelineProps) {
  return (
    <section className="panel timeline">
      <div className="panel__header">
        <div>
          <div className="panel__eyebrow">事件归并</div>
          <h2 className="panel__title">运行时间线</h2>
        </div>
        <span className="panel__count">{turns.length} 轮</span>
      </div>

      {turns.length === 0 ? (
        <EmptyState
          title={polling ? '等待第一轮事件…' : '后端没有返回轮次事件'}
          description={
            polling
              ? '页面每 1.5 秒按 after_seq 增量拉取事件，第一轮开始后这里会出现记录。'
              : '可能是任务尚未开始、已结束但没有事件，或后端没有持久化事件。可以点击上方“刷新”重试。'
          }
        />
      ) : (
        <ol className="timeline__list">
          {/*
            用 <ol> 而不是 <div>：轮次本来就有顺序，语义更正确。
            每个 <li> 里放一个 button，点击区域更大，键盘也能操作。
          */}
          {turns.map((turn, index) => {
            /*
              派生出来两个布尔值，下面 JSX 里就不用重复写条件：
              - active：当前卡片是否被选中；
              - isLatest：是否是最后一轮（用于显示“最新”标签）。
              `index === turns.length - 1` 是数组下标判断，
              只在渲染这一层使用，不会写回数据。
            */
            const active = selectedTurn === turn.turn
            const isLatest = index === turns.length - 1

            return (
              <li key={turn.turn} className="timeline__item">
                {/*
                  type="button" 必须写。默认 button 在 form 里是 submit，
                  点了可能触发表单提交；显式声明成普通按钮更安全。
                  onClick={() => onSelectTurn(turn.turn)} 是箭头函数：
                  点击时才执行，而不是渲染时立刻执行。
                */}
                <button
                  type="button"
                  className={classNames('timeline-card', active && 'timeline-card--active')}
                  onClick={() => onSelectTurn(turn.turn)}
                  aria-current={active ? 'step' : undefined}
                >
                  <div className="timeline-card__top">
                    <span className="timeline-card__turn">第 {turn.turn} 轮</span>
                    <StatusBadge status={turn.status} kind="turn" />
                    {isLatest ? <span className="tag tag--accent">最新</span> : null}
                  </div>

                  <div className="timeline-card__meta">
                    {/*
                      JSX 里用 {} 包住 JavaScript 表达式。
                      `turn.started_at ? ... : ...` 是三元表达式，
                      没有开始时间时显示占位文案，而不是空白。
                    */}
                    <span>{turn.started_at ? formatDateTime(turn.started_at) : '时间未返回'}</span>
                    <span>{turn.tool_calls.length} 个工具调用</span>
                    <span>{turn.event_count} 条事件</span>
                  </div>

                  {/*
                    `turn.assistant_text ? ... : ...` 会先把空字符串当成假值，
                    所以模型还没输出文本时不会渲染一个空的 <p>。
                    有文本时先用 replace(/\s+/g, ' ') 把换行、连续空格压成一个空格，
                    再用 truncateText 截到 140 字，避免卡片被长文本撑得很高。
                    正则里的 g 表示“全局匹配”，不是只替换第一个。
                  */}
                  {turn.assistant_text ? (
                    <p className="timeline-card__text">
                      {truncateText(turn.assistant_text.replace(/\s+/g, ' '), 140)}
                    </p>
                  ) : (
                    <p className="timeline-card__text timeline-card__text--muted">
                      {/*
                        这里区分两种“没有文本”：
                        - model_response_seen 为 true：模型确实响应过，只是没有文本；
                        - false：还在等模型响应。
                        不能把两种情况都写成“加载中”，否则会误导用户。
                      */}
                      {turn.model_response_seen ? '模型未返回文本内容' : '等待模型响应…'}
                    </p>
                  )}

                  {/*
                    `turn.tool_calls.length > 0 ? (...) : null` 是“条件渲染”：
                    不满足条件时返回 null，React 什么都不渲染。
                    注意不能用 `&&` 包住数字：如果长度是 0，`0 && <div>` 会渲染出 0。
                  */}
                  {turn.tool_calls.length > 0 ? (
                    <div className="timeline-card__tools">
                      {/*
                        slice(0, 3) 取数组前 3 项，只展示前三个工具。
                        完整的工具列表在右侧详情里看，卡片保持紧凑。
                      */}
                      {turn.tool_calls.slice(0, 3).map((call) => (
                        <span className="tool-chip" key={call.tool_call_id}>
                          {/*
                            模板字符串（反引号）可以拼接变量：
                            `tool-chip__dot--${call.status}` 会变成
                            'tool-chip__dot--completed' 之类的 class。
                            aria-hidden="true" 表示这个小圆点只是装饰。
                          */}
                          <span className={`tool-chip__dot tool-chip__dot--${call.status}`} aria-hidden="true" />
                          {call.tool_name}
                        </span>
                      ))}
                      {/* 超过 3 个时显示“+N”，提示还有更多工具调用。 */}
                      {turn.tool_calls.length > 3 ? (
                        <span className="tool-chip tool-chip--more">
                          +{turn.tool_calls.length - 3}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

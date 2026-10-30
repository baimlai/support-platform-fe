/**
 * ============================================================================
 * 原始事件流
 * ============================================================================
 *
 * 时间线是“归并后的轮次”，这个面板展示后端返回的原始事件。
 * 用途：联调、排查“为什么时间线里没有某个工具”这类问题。
 *
 * 每条事件包含：
 * - seq：序号；
 * - ts：时间；
 * - type：事件类型；
 * - turn：属于第几轮；
 * - data：事件数据（可能很大，折叠展示）。
 */

import type { TaskEvent } from '../api/types'
import { formatDateTime, prettyJson } from '../utils/format'
import { EmptyState } from './EmptyState'

/**
 * props 的形状：只接收一个事件数组。
 *
 * `TaskEvent[]` 表示“由 TaskEvent 组成的数组”。
 * 如果写成 `TaskEvent` 就变成单个对象，和 App 传进来的数组对不上。
 */
interface EventLogProps {
  events: TaskEvent[]
}

export function EventLog({ events }: EventLogProps) {
  return (
    <section className="panel event-log">
      <div className="panel__header">
        <div>
          <div className="panel__eyebrow">原始数据</div>
          <h2 className="panel__title">事件流</h2>
        </div>
        <span className="panel__count">{events.length} 条</span>
      </div>

      {/*
        JSX 里的三元表达式：
          condition ? <A /> : <B />
        条件为真渲染 A，否则渲染 B。
        这里“没有事件”和“有事件”的页面结构完全不同，用三元最直接。
      */}
      {events.length === 0 ? (
        <EmptyState
          title="还没有事件"
          description="任务开始后，后端会持续写入事件；页面按 after_seq 增量拉取并展示在这里。"
        />
      ) : (
        <div className="event-log__list">
          {/*
            key={event.seq} 用事件序号做 key。
            为什么不用数组下标？事件是增量追加的，用 seq 能让 React
            准确识别“哪一行还是原来那一行”，展开状态不会串到别的事件上。
          */}
          {events.map((event) => (
            /*
              <details> / <summary> 是浏览器原生折叠组件：
              点 summary 就展开/收起下面的内容，不需要自己写 state。
              这里用 <pre> 展示 JSON，pre 会保留空格和换行。
            */
            <details className="event-row" key={event.seq}>
              <summary className="event-row__summary">
                <span className="event-row__seq">#{event.seq}</span>
                <span className="event-row__type">{event.type}</span>
                <span className="event-row__meta">
                  {/*
                    `event.turn !== null && event.turn !== undefined` 是显式判断。
                    为什么不直接写 event.turn ? ... ？
                    因为 turn 可能等于 0；如果后端从 0 开始编号，直接判断
                    会把“第 0 轮”误判成“任务级”。显式比较 null/undefined 更稳。
                  */}
                  {event.turn !== null && event.turn !== undefined ? `第 ${event.turn} 轮` : '任务级'}
                </span>
                {/*
                  event.ts 可能为空。三元表达式保证空值不会传给格式化函数。
                  `? :` 也可以读成“有值就格式化，没有就显示占位文案”。
                */}
                <span className="event-row__meta">{event.ts ? formatDateTime(event.ts) : '时间未返回'}</span>
              </summary>
              {/* prettyJson 把 data 转成缩进 JSON；字符串会原样返回。 */}
              <pre className="event-row__data">{prettyJson(event.data)}</pre>
            </details>
          ))}
        </div>
      )}
    </section>
  )
}

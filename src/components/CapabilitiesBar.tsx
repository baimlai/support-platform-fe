/**
 * ============================================================================
 * 能力目录
 * ============================================================================
 *
 * 展示后端注册的 Skill 和工具。
 *
 * 重要区分：
 * - 能力目录回答“后端有哪些工具可用”；
 * - 时间线里的 tool_execution_* 回答“本次任务实际调用了哪些工具”。
 *
 * 两者不能混为一谈。例如目录里有 5 个工具，本次只调用了 2 个，
 * 不能因为目录里有就把另外 3 个显示成“已执行”。
 *
 * 显示约定：
 * - 技能和工具分组展示，数量为 0 时明确写“未注册”；
 * - 有描述时放在 title 提示里，不把长描述铺满侧栏。
 */

import type { CapabilitiesView, CapabilityView } from '../api/types'
import { EmptyState, Notice } from './EmptyState'
import { LayersIcon, RefreshIcon } from './icons'

/**
 * 能力目录面板的参数。
 *
 * `capabilities` 初始是 null（还没请求或请求失败），
 * 所以渲染前必须先判断，不能直接访问 capabilities.skills。
 */
interface CapabilitiesBarProps {
  capabilities: CapabilitiesView | null
  loading: boolean
  error: string | null
  onRetry: () => void
}

/**
 * 一组能力标签（技能或工具）。
 *
 * 这个组件被复用两次：一次传 skills，一次传 tools。
 * 把“标题、列表、空文案”作为参数传进来，就不用写两遍几乎一样的 JSX。
 *
 * 参数仍然使用内联对象类型。`emptyText: string` 是必填的，
 * 调用方忘了传，TypeScript 会直接报错。
 */
function CapabilityGroup({
  title,
  items,
  emptyText,
}: {
  title: string
  items: CapabilityView[]
  emptyText: string
}) {
  return (
    <div className="capability-group">
      <div className="capability-group__title">
        {title}
        <span className="capability-group__count">{items.length}</span>
      </div>
      {/* 列表为空时显示“后端未注册”，而不是一片空白让用户以为页面坏了。 */}
      {items.length > 0 ? (
        <div className="capability-group__items">
          {items.map((item) => (
            <span
              key={item.name}
              className="chip"
              // 后端没有描述时传 undefined，浏览器就不会显示空的 title 提示。
              title={item.description ?? undefined}
            >
              {/*
                `item.label ?? item.name`：
                - label 是人类可读名称（例如“慢 SQL 调查”）；
                - 后端没给 label 时退回内部 name（例如 slow_sql）。
                `??` 只会把 null/undefined 当成“没有值”，空字符串仍会按后端给的内容展示。
              */}
              {item.label ?? item.name}
            </span>
          ))}
        </div>
      ) : (
        <div className="capability-group__empty">{emptyText}</div>
      )}
    </div>
  )
}

export function CapabilitiesBar({ capabilities, loading, error, onRetry }: CapabilitiesBarProps) {
  return (
    <section className="panel capabilities">
      <div className="panel__header">
        <div>
          <div className="panel__eyebrow">后端注册</div>
          <h2 className="panel__title">
            <LayersIcon size={16} />
            能力目录
          </h2>
        </div>
        {/*
          这里直接写 onClick={onRetry}，而不是包一层箭头函数：
          onRetry 本身不需要参数，React 会把点击事件传给它，
          但类型是 () => void，多传参数不会影响调用，所以可以直传。
          如果回调需要额外参数（例如 id），就必须写成 `() => onRetry(id)`。
        */}
        <button
          type="button"
          className="icon-button"
          onClick={onRetry}
          disabled={loading}
          title="重新读取能力目录"
        >
          <RefreshIcon size={14} />
        </button>
      </div>

      {error ? (
        <Notice tone="error">
          能力目录加载失败：{error}
        </Notice>
      ) : null}

      {/*
        这里是一串嵌套三元表达式，按顺序理解：
        1. 有数据        -> 正常渲染两组能力；
        2. 没数据但加载中 -> 显示加载提示；
        3. 没数据、没加载、也没有错误 -> 说明还没点过刷新，提示去点；
        4. 其余情况（有错误）-> null，上面的 Notice 已经显示错误了。
        嵌套三元可读性一般，但这里每个分支只返回一个简单节点，仍然清楚。
        如果分支再复杂，建议改成 if 语句提前 return。
      */}
      {capabilities ? (
        <>
          <CapabilityGroup
            title="Skills"
            items={capabilities.skills}
            emptyText="后端未注册 Skill"
          />
          <CapabilityGroup
            title="Tools"
            items={capabilities.tools}
            emptyText="后端未注册工具"
          />
          <p className="capabilities__hint">
            这里只表示后端注册了哪些能力；本次实际调用了什么，以时间线中的工具事件为准。
          </p>
        </>
      ) : loading ? (
        <EmptyState title="正在读取能力目录…" description="请求 /api/capabilities。" />
      ) : !error ? (
        <EmptyState title="尚未读取能力目录" description="点击右上角刷新重试。" />
      ) : null}
    </section>
  )
}

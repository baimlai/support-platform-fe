/**
 * 未选择任务时的欢迎区。
 *
 * 这里只解释“这个页面怎么用”，不展示任何执行结果。
 * 任务结果必须由后端真实事件驱动，不能在前端放一段示例时间线冒充运行结果。
 */

import { DatabaseIcon, FileIcon, LayersIcon, PlayIcon } from './icons'

/**
 * 流程步骤定义。
 *
 * 这里的数组是在模块加载时写死的静态数据，不是后端数据，也不代表任何一次
 * 真实执行。它只在“还没创建任务”时告诉用户页面怎么用。
 *
 * 数组元素没有显式写类型，TypeScript 会自动推断成
 * `{ icon: JSX.Element; title: string; description: string }[]`。
 * `icon` 里直接放 JSX，说明“值可以是 React 元素”，渲染时把它放进 {}
 * 就会被 React 解释成组件输出。
 */
const STEPS = [
  {
    icon: <FileIcon size={18} />,
    title: '1. 提交工单',
    description: '选择后端提供的模拟样例，或手工粘贴一段 DBA 工单。',
  },
  {
    icon: <LayersIcon size={18} />,
    title: '2. 观察 Agent',
    description: '页面按后端事件流还原每一轮：模型响应、工具调用、证据引用。',
  },
  {
    icon: <DatabaseIcon size={18} />,
    title: '3. 查看结论',
    description: '任务结束后查看 Topic、最终报告和原始证据，所有内容都来自后端。',
  },
]

export function WelcomePanel() {
  return (
    <div className="welcome">
      <div className="welcome__hero">
        <div className="welcome__eyebrow">
          <PlayIcon size={14} />
          READY
        </div>
        <h1>从一条 DBA 工单开始</h1>
        <p>
          左侧提交工单后，后端 Agent 会按轮次调用只读工具排查。样例覆盖 MySQL、PostgreSQL、
          Redis、MongoDB、Elasticsearch 和 ClickHouse；页面展示的是后端真实事件与数据，
          没有返回的内容会明确显示为空，不会生成示例结果。
        </p>
      </div>

      <div className="welcome__steps">
        {/*
          map 的写法：把数组里的每一项转成一个 JSX 元素，最后得到一个新数组。
          React 渲染数组时必须给每个元素一个稳定的 key，否则更新列表时
          React 只能按位置猜，容易把状态对应错。
          这里用 step.title 做 key，因为三条文案固定且不会重复。
        */}
        {STEPS.map((step) => (
          <div className="welcome__step" key={step.title}>
            {/* {step.icon} 里的值本身就是一个 React 元素，直接渲染即可。 */}
            <span className="welcome__step-icon">{step.icon}</span>
            <div>
              <div className="welcome__step-title">{step.title}</div>
              <div className="welcome__step-description">{step.description}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="welcome__hint">
        提示：任务运行中可以随时刷新页面，页面会按任务 ID 重新拉取事件；刷新不会取消后端任务。
      </div>
    </div>
  )
}

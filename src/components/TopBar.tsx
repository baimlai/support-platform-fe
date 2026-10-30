/**
 * 顶部栏。
 *
 * 只展示应用名称、用途说明和当前 API 地址。
 * 这里不放“后端已连接”这种状态，因为前端没有专门的健康检查接口；
 * 随便显示一个绿点会变成假状态。真正的连接情况由具体请求的错误提示来体现。
 */

import { DatabaseIcon } from './icons'

/**
 * 组件参数的类型。
 *
 * `interface` 用来描述“一个对象应该长什么样”。这里表示调用 TopBar 时
 * 必须传一个对象，里面有一个字符串字段 apiLabel。
 *
 * 例子：
 *   <TopBar apiLabel="通过 Vite 代理 /api" />   // 正确
 *   <TopBar />                                  // 编译报错：缺少 apiLabel
 */
interface TopBarProps {
  /** 当前 API 地址，来自 client.ts 的 apiBaseLabel。 */
  apiLabel: string
}

/**
 * 函数参数写 `{ apiLabel }: TopBarProps` 是“解构赋值”：
 * 从传入的 props 对象里直接把 apiLabel 取出来，后面不用写 props.apiLabel。
 * 这和 JavaScript 的 `const { apiLabel } = props` 是同一件事。
 */
export function TopBar({ apiLabel }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        {/*
          aria-hidden="true" 告诉读屏软件“这个图标只是装饰，不用念出来”。
          如果图标旁边已经有文字说明（这里是标题），图标就不该被重复朗读。
        */}
        <span className="topbar__logo" aria-hidden="true">
          <DatabaseIcon size={20} />
        </span>
        <div>
          <div className="topbar__title">DBA 工单诊断台</div>
          <div className="topbar__subtitle">慢 SQL 排查 · Agent 运行过程可追踪</div>
        </div>
      </div>

      <div className="topbar__meta">
        {/* title 属性让用户悬停时能看到完整地址，长地址不会把顶栏撑破。 */}
        <span className="topbar__api" title={apiLabel}>
          API：{apiLabel}
        </span>
      </div>
    </header>
  )
}

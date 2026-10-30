/**
 * ============================================================================
 * 页面里用到的少量内联图标
 * ============================================================================
 *
 * 为什么不引入图标库？
 * 当前只需要几个固定图标，内联 SVG 体积更小，也少一个依赖。
 * 每个图标都是一个 React 函数组件，用法：
 *
 *   <PlayIcon size={16} />
 *
 * 图标统一使用 currentColor 描边，颜色跟随父元素，方便在明暗主题下复用。
 * 所有图标都标记 aria-hidden，避免读屏软件把装饰性图形读出来。
 */

/**
 * 所有图标共用的 props。
 *
 * `?` 表示可选：调用方可以只写 <PlayIcon />，不传任何参数。
 */
interface IconProps {
  size?: number
  className?: string
}

/**
 * 生成 SVG 的公共属性。
 *
 * `strokeLinecap: 'round' as const`：
 * - 'round' 本身是字符串字面量；
 * - 如果不加 as const，TypeScript 可能把它推断成 string；
 * - 而 SVG 的 strokeLinecap 只接受 'butt' | 'round' | 'square' 等有限值，
 *   加 as const 后类型更精确，赋值不会报错。
 *
 * 返回对象的类型由 TypeScript 自动推断，不用手写。
 */
function baseProps(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  }
}

/** 播放图标：用于“开始诊断”按钮。 */
export function PlayIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** 停止图标：用于“取消任务”按钮。 */
export function StopIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** 刷新图标：用于重新拉取样例、刷新任务、刷新证据列表。 */
export function RefreshIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M20 11a8 8 0 0 0-14.9-4M4 5v4h4" />
      <path d="M4 13a8 8 0 0 0 14.9 4M20 19v-4h-4" />
    </svg>
  )
}

/**
 * 箭头图标：用于折叠面板。
 *
 * 这里在 IconProps 基础上又加了 `direction?: 'right' | 'down'`，
 * 是 TypeScript 的“交叉类型”（Intersection Type）：
 *   IconProps & { direction?: ... }
 * 表示“既要有 IconProps 的字段，也要有 direction”。
 *
 * 两个箭头方向共用同一个 path，只是旋转 90 度：
 *   direction === 'down' ? 'rotate(90 12 12)' : undefined
 */
export function ChevronIcon({
  size = 16,
  className,
  direction = 'right',
}: IconProps & { direction?: 'right' | 'down' }) {
  return (
    <svg
      {...baseProps(size, className)}
      transform={direction === 'down' ? 'rotate(90 12 12)' : undefined}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

/** 复制图标：用于复制任务 ID、报告正文。 */
export function CopyIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h8" />
    </svg>
  )
}

/** 文件图标：用于证据。 */
export function FileIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4M9.5 12h5M9.5 16h5" />
    </svg>
  )
}

/** 关闭图标：用于关闭证据抽屉。 */
export function CloseIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}

/** 警告图标：用于错误、失败状态。 */
export function AlertIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M12 4 3.5 19h17L12 4Z" />
      <path d="M12 9v4.5M12 17h.01" />
    </svg>
  )
}

/** 数据库图标：用于工单/实例信息。 */
export function DatabaseIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </svg>
  )
}

/** 层叠图标：用于能力目录 / Skill。 */
export function LayersIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...baseProps(size, className)}>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5M3 17l9 5 9-5" />
    </svg>
  )
}

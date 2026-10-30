/**
 * ============================================================================
 * 纯展示用的小工具（format.ts）
 * ============================================================================
 *
 * 这里只做“把值变成好看的字符串”以及少量浏览器能力封装，不做业务判断。
 * 例如“状态是否终态”属于业务判断，放在 normalize.ts；这里只负责格式化和 class 拼接。
 *
 * 约定：
 * - 空值统一显示为 '—'，页面不用到处判断；
 * - 无法解析的值尽量原样返回或显示 '—'，不猜测后端意图。
 */

/**
 * 拼接 className，自动过滤掉 false / null / undefined。
 *
 * 为什么需要它？
 * React 里写条件 class 很常见：
 *
 *   <div className={classNames('card', isActive && 'card--active')}>
 *
 * 如果 isActive 为 false，`false` 会被过滤掉，不会变成字符串 "false"。
 *
 * `...values` 是剩余参数（rest parameters），把调用时传的所有参数收集成数组。
 * `Array<string | false | null | undefined>` 表示数组元素可能是这四种类型之一。
 * `.filter(Boolean)` 会过滤掉所有“假值”（false、null、undefined、''、0）。
 */
export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

/**
 * 把时间格式化成“月/日 时:分:秒”。
 *
 * 后端的时间字段可能有两种形态：
 * - ISO 字符串：'2026-10-29T10:00:00+08:00'；
 * - 数字时间戳：1793273052889（毫秒）或 1793273052（秒）。
 *
 * 参数类型写成 `string | number | null | undefined`，是因为 TS 的联合类型
 * 表示“这几种值都允许传进来”。函数内部先用 `typeof value` 区分，
 * 再统一转成 Date。这样组件不用关心后端到底给的是字符串还是数字。
 *
 * 处理步骤：
 * 1. 空值 -> '—'（页面统一用破折号表示“无数据”）；
 * 2. 数字或纯数字字符串按时间戳处理；
 * 3. 其他字符串交给 `new Date()` 解析；
 * 4. `Number.isNaN(date.getTime())` 判断是否解析失败；
 * 5. 用 Intl.DateTimeFormat 按中文习惯格式化。
 *
 * 例子（实际分隔符由浏览器的 zh-CN 区域格式决定，通常是斜杠）：
 *   formatDateTime('2026-10-29T10:00:00+08:00') -> '10/29 10:00:00'
 *   formatDateTime(1793273052889)               -> '10/29 19:24:12'
 *   formatDateTime('1793273052889')             -> 同上（后端把数字转成字符串时也能用）
 *   formatDateTime(null)                         -> '—'
 *   formatDateTime('not-a-date')                 -> 'not-a-date'（原样返回，方便排查）
 *
 * 返回类型 `string` 表示一定返回字符串，不会返回 undefined。
 */
export function formatDateTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'

  let date: Date

  if (typeof value === 'number') {
    date = new Date(value)
  } else {
    const trimmed = value.trim()

    /**
     * `/^\d+$/` 只匹配“从头到尾都是数字”的字符串。
     * 如果后端给的是 10 位秒级时间戳，先乘 1000 转成毫秒；
     * 13 位毫秒时间戳直接使用。
     *
     * 注意：不能对任意字符串做 Number()，因为 `Number('2026-10-29')` 是 NaN，
     * 这里先用正则确认它确实是纯数字，避免把正常日期字符串误判成时间戳。
     */
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed)
      date = new Date(trimmed.length <= 10 ? numeric * 1000 : numeric)
    } else {
      date = new Date(trimmed)
    }
  }

  if (Number.isNaN(date.getTime())) return String(value)

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

/**
 * 格式化毫秒数。
 *
 * 规则：
 * - 小于 1000 ms：显示 “123 ms”；
 * - 大于等于 1000 ms：显示 “1.23 s”；
 * - 非数字/空值：显示 “—”。
 *
 * `Number.isFinite(value)` 同时排除 NaN、Infinity 和 -Infinity。
 * 注意这里先判断 `value === null || value === undefined`，
 * 因为 Number.isFinite(null) 是 false，但报错信息不如显式判断清楚。
 */
export function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toFixed(2)} s`
}

/**
 * 把数字格式化成带千分位的字符串。
 *
 * 例子：
 *   formatNumber(12345) -> '12,345'
 *   formatNumber(null)  -> '—'
 */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('zh-CN').format(value)
}

/**
 * 格式化字节数（或后端给的 size 字段）。
 *
 * 注意：后端 evidence.size 的单位不一定是字节，可能是字符数。
 * 所以页面展示时会写“大小/长度”这类中性词，避免误导。
 *
 * 例子：
 *   formatBytes(512)       -> '512 B'
 *   formatBytes(2048)      -> '2.0 KB'
 *   formatBytes(5 * 1024 * 1024) -> '5.00 MB'
 */
export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * 缩短长 ID，方便界面展示。
 *
 * 默认保留前 8 位和后 4 位，中间用省略号：
 *   '1234567890abcdef' -> '12345678…cdef'
 *
 * 如果 ID 本身不长（长度 <= head + tail + 1），就原样返回，避免把短 ID 也截断。
 *
 * 参数 `head = 8, tail = 4` 是默认参数：调用方可以只传 value，
 * 也可以传 `shortId(id, 6, 3)` 自定义保留长度。
 */
export function shortId(value: string, head = 8, tail = 4): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

/**
 * 截断长文本。
 *
 * `text.slice(0, maxLength)` 取前 maxLength 个字符；
 * 末尾加省略号，提醒用户“这里还有内容没显示”。
 *
 * 例子：
 *   truncateText('abcdef', 3) -> 'abc…'
 *   truncateText('ab', 3)     -> 'ab'（没超长就不加省略号）
 */
export function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

/**
 * 把任意值格式化成方便阅读的 JSON 字符串。
 *
 * - 字符串原样返回（避免 JSON.stringify('abc') 变成 '"abc"'）；
 * - 对象/数组用 2 空格缩进；
 * - 如果对象里有循环引用，JSON.stringify 会抛错，这里兜底转成 String(value)。
 *
 * 例子：
 *   prettyJson({ a: 1 }) -> '{\n  "a": 1\n}'
 *   prettyJson('abc')    -> 'abc'
 */
export function prettyJson(value: unknown): string {
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * 复制文本到剪贴板。
 *
 * 返回 Promise<boolean>：
 * - true：复制成功；
 * - false：浏览器拒绝或当前环境不支持（例如非 HTTPS、用户未授权）。
 *
 * 为什么不直接抛错？
 * 复制失败是很常见的非关键错误，页面只需要提示“复制失败”，不需要中断流程。
 *
 * 调用方通常这样写：
 *   const ok = await copyText(taskId)
 *   setCopied(ok)
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

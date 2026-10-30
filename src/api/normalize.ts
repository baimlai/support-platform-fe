/**
 * ============================================================================
 * 后端原始数据 -> 页面模型（normalize 层）
 * ============================================================================
 *
 * 这个文件是“数据翻译官”。后端返回的 JSON 可能有这些情况：
 * - 同一个意思用了不同字段名：`sample_id` / `id` / `key`；
 * - 某个字段有时是字符串、有时是对象；
 * - 某些字段后端暂时没返回；
 * - 事件 data 的形状随事件类型变化。
 *
 * 如果让每个页面组件自己判断，代码会变成这样：
 *
 *   const name = raw.tool_name ?? raw.toolName ?? raw.name ?? 'unknown'
 *   const list = Array.isArray(raw.events) ? raw.events : raw.events?.items ?? []
 *
 * 到处写这种代码既难读，也容易漏。于是集中到这里：组件只拿到“字段一定齐全”的页面模型。
 *
 * 本文件的核心原则：
 * - 后端没有的数据就保持为空，绝不补一个看起来像真的假值；
 * - 所有 `unknown` 在使用前都要判断类型；
 * - 页面组件不直接依赖后端原始字段。
 *
 * 类型处理约定：
 * - 后端字段先当 `unknown`，判断类型后再使用；判断逻辑集中在本文件，不散落到组件里；
 * - 过滤数组时用类型谓词（`item is TopicFact`）告诉编译器过滤后的元素类型；
 * - `??` 只在 null/undefined 时回退，不会把 0 或空字符串误判为“没有值”；
 * - `as` 只做类型断言，运行时不转换数据，安全性来自前面的类型判断。
 */

import type {
  CapabilitiesView,
  CapabilityView,
  CreateTaskResponse,
  EventPage,
  EvidenceChunk,
  EvidenceItemView,
  FinalReport,
  ModelProviderView,
  ModelsView,
  ReportEvidence,
  SampleTicket,
  SampleView,
  TaskDetail,
  TaskEvent,
  TicketPayload,
  TopicCandidate,
  TopicFact,
  TopicView,
  TurnView,
} from './types'
import { formatDateTime, truncateText } from '../utils/format'

/* ------------------------------------------------------------------ */
/* 基础读取工具：后端字段可能是 string / number / object，这里统一兜底 */
/* ------------------------------------------------------------------ */

/**
 * 把 unknown 安全地转成“对象”，不是对象就返回 null。
 *
 * 为什么要排除数组？
 * 在 JavaScript 里 `typeof [] === 'object'` 也是 true。
 * 如果只判断 `typeof value === 'object'`，数组也会被当成对象，
 * 后面 `value.xxx` 可能拿到奇怪的结果。所以这里加 `!Array.isArray(value)`。
 *
 * 例子：
 *   asRecord({ a: 1 })      -> { a: 1 }
 *   asRecord([1, 2])        -> null
 *   asRecord('hello')       -> null
 *   asRecord(null)          -> null
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * 把 unknown 统一成数组。
 *
 * 后端有时返回数组，有时返回单个对象，有时返回 null。
 * 这里统一成数组，组件就可以放心 `.map()`。
 *
 * 例子：
 *   asArray([1, 2]) -> [1, 2]
 *   asArray('a')    -> ['a']
 *   asArray(null)   -> []
 *
 * 注意：返回类型是 `unknown[]`，数组里的元素类型仍然未知，
 * 使用元素时还要继续判断。
 */
export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === null || value === undefined) return []
  return [value]
}

/**
 * 按顺序尝试多个字段名，返回第一个“有内容”的字符串。
 *
 * 为什么需要它？
 * 后端可能用 `sample_id`，也可能用 `id`；可能用 `title`，也可能用 `name`。
 * 与其在每个调用点写一长串 `??`，不如把“候选字段名”作为数组传进来。
 *
 * 例子：
 *   firstString({ id: 'abc' }, ['sample_id', 'id'])       -> 'abc'
 *   firstString({ sample_id: '  ' }, ['sample_id'])       -> null（全空格不算）
 *   firstString({ count: 12 }, ['count'])                -> '12'（数字转字符串）
 *   firstString(null, ['id'])                            -> null
 *
 * 返回类型 `string | null`：找到就返回字符串，找不到就返回 null。
 * 调用方必须处理 null，不能直接 `.toUpperCase()`。
 */
export function firstString(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null

  for (const key of keys) {
    const value = record[key]

    // 字符串：去掉首尾空格，空字符串视为“没找到”。
    if (typeof value === 'string' && value.trim() !== '') return value.trim()

    // 数字：例如后端把 id 写成 12，这里转成 '12'。
    // Number.isFinite 用来排除 NaN 和 Infinity。
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }

  return null
}

/**
 * 按顺序找第一个“原样的字符串”，不做 trim。
 *
 * 为什么需要它？
 * firstString() 会去掉首尾空格，这对 ID、工具名很合适，
 * 但对“证据正文”是错的：日志里的缩进和行尾空格也是内容的一部分。
 * 例如后端返回 4000 个字符的证据片段，最后一个是空格，
 * firstString 会把它 trim 成 3999 个字符：
 * - 页面少显示一个字符；
 * - “下一段”从 3999 开始算，和上一段重叠一个字符。
 *
 * 所以证据正文单独用这个函数读取：
 * - 只要是字符串就原样返回，包括空字符串（空证据也是合法结果）；
 * - 数字/对象不在这里转换，交给调用方用 textFromContent 兜底。
 */
function firstRawString(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null

  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') return value
  }

  return null
}

/**
 * 按顺序尝试多个字段名，返回第一个有效数字。
 *
 * 后端可能把 duration 写成 120，也可能写成 "120"。
 * 两种都兼容；不是数字的字符串（例如 "abc"）会被跳过。
 *
 * 例子：
 *   firstNumber({ duration_ms: 120 }, ['duration_ms'])       -> 120
 *   firstNumber({ duration: '120' }, ['duration'])          -> 120
 *   firstNumber({ duration: 'abc' }, ['duration'])          -> null
 */
export function firstNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  if (!record) return null

  for (const key of keys) {
    const value = record[key]

    if (typeof value === 'number' && Number.isFinite(value)) return value

    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value)
    }
  }

  return null
}

/**
 * 按顺序尝试多个字段名，返回第一个布尔值。
 *
 * 兼容三种情况：
 * - 真正的布尔值：true / false；
 * - 字符串：'true' / 'false'；
 * - 其他值：跳过。
 *
 * 返回类型是 `boolean | undefined`，注意和 `boolean | null` 的区别：
 * 这里用 undefined 表示“没找到”，因为 undefined 也是可选字段的默认值。
 */
export function firstBoolean(record: Record<string, unknown> | null, keys: string[]): boolean | undefined {
  if (!record) return undefined

  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'boolean') return value
    if (value === 'true') return true
    if (value === 'false') return false
  }

  return undefined
}

/**
 * 按顺序尝试多个字段名，返回第一个“不是 undefined / null”的值。
 *
 * 和 firstString / firstNumber 不同，这个函数不限制值的类型，
 * 适合处理结构不固定的字段，例如 args / result / structured。
 *
 * 例子：
 *   firstValue({ result: { rows: [] } }, ['result']) -> { rows: [] }
 *   firstValue({ result: null }, ['result'])         -> undefined
 */
export function firstValue(record: Record<string, unknown> | null, keys: string[]): unknown {
  if (!record) return undefined

  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key]
  }

  return undefined
}

/**
 * 把“模型消息内容”安全地转成一段可读文本。
 *
 * 后端/模型的消息 content 可能是很多种形状：
 * - 字符串：'分析完成'
 * - 数组：[{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }]
 * - 对象：{ text: '分析完成' } 或 { content: '...' }
 * - null / undefined
 *
 * 这个函数负责把常见形状统一成字符串。
 * 遇到不认识的对象，会退化成格式化后的 JSON，至少保证“不会丢信息”。
 *
 * 例子：
 *   textFromContent('hi')                         -> 'hi'
 *   textFromContent([{ text: 'a' }, { text: 'b' }]) -> 'a\nb'
 *   textFromContent({ content: 'ok' })            -> 'ok'
 */
export function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value
      .map((item) => blockToText(item))
      .filter((item) => item !== '')
      .join('\n')
  }
  const record = asRecord(value)
  if (!record) return String(value)
  if (typeof record.text === 'string') return record.text
  if ('content' in record) {
    const nested = textFromContent(record.content)
    if (nested) return nested
  }
  return JSON.stringify(record, null, 2)
}

/**
 * 处理内容数组里的单个块。
 *
 * 模型返回的 content 数组可能混着：
 * - { type: 'text', text: '...' }        -> 我们想展示的正文
 * - { type: 'toolCall', ... }            -> 工具调用，正文区不展示
 * - { type: 'thinking', ... }            -> 思考过程，正文区不展示
 *
 * 为什么要跳过 toolCall / thinking？
 * 因为工具调用会通过 tool_execution_* 事件单独展示；
 * 思考过程当前不要求在正文里展示。跳过它们可以避免时间线里出现一堆 JSON。
 *
 * 返回空字符串表示“这个块不需要展示”。
 */
function blockToText(block: unknown): string {
  if (typeof block === 'string') return block
  if (block === null || block === undefined) return ''
  const record = asRecord(block)
  if (!record) return String(block)
  const type = firstString(record, ['type'])
  if (type === 'toolCall' || type === 'tool_call' || type === 'thinking' || type === 'reasoning') {
    return ''
  }
  if (typeof record.text === 'string') return record.text
  if ('content' in record) return textFromContent(record.content)
  return JSON.stringify(record, null, 2)
}

/**
 * 如果字符串看起来像 JSON，就尝试解析；否则原样返回。
 *
 * 为什么只尝试 `{` / `[` 开头？
 * 因为普通文本（例如 'hello'）也能被 JSON.parse 成字符串或数字，
 * 但那样会把“普通文本”误当成 JSON。这里只处理明显的对象/数组。
 *
 * 例子：
 *   parseJsonIfPossible('{"a":1}') -> { a: 1 }
 *   parseJsonIfPossible('hello')   -> 'hello'
 *   parseJsonIfPossible('{bad}')   -> '{bad}'（解析失败就原样返回）
 */
function parseJsonIfPossible(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value

  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

/**
 * 从数组或对象里取出列表。
 *
 * 后端可能返回：
 *   []
 *   { items: [] }
 *   { samples: [] }
 *   { data: [] }
 * 这里按候选键依次尝试，找到数组就返回；都没有就返回空数组。
 *
 * 返回 `unknown[]` 而不是 `any[]`，元素使用前仍需判断类型。
 */
function listFrom(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value
  const record = asRecord(value)
  if (!record) return []
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[]
  }
  return []
}

/* ------------------------------------------------------------------ */
/* 样例与创建任务                                                       */
/* ------------------------------------------------------------------ */

/**
 * 把后端样例列表转成页面用的 SampleView[]。
 *
 * 后端每个样例可能是字符串，也可能是对象；对象里的字段名也不完全统一。
 * 这里逐个兼容，最终保证每个样例都有：
 * - id：创建任务时用；
 * - label：展示名；
 * - text：工单正文；
 * - mock：是否模拟数据。
 *
 * `list.map((item, index) => ...)` 里的 index 从 0 开始，
 * 用来在没有 ID 时生成 `sample-1` 这样的兜底 ID。
 */
export function normalizeSamples(raw: unknown): SampleView[] {
  const list = listFrom(raw, ['samples', 'items', 'data'])
  return list.map((item, index) => {
    if (typeof item === 'string') {
      return {
        id: `sample-${index + 1}`,
        label: truncateText(item, 48),
        text: item,
        mock: false,
        raw: item,
      }
    }
    const record = asRecord(item) ?? {}
    const id = firstString(record, ['sample_id', 'id', 'key', 'slug']) ?? `sample-${index + 1}`
    const label = firstString(record, ['name', 'title', 'label', 'description']) ?? id
    const text =
      firstString(record, ['ticket_text', 'text', 'content', 'description']) ??
      JSON.stringify(record, null, 2)
    return {
      id,
      label,
      text,
      mock: firstBoolean(record, ['mock', 'is_mock', 'isMock']) ?? false,
      instanceId: firstString(record, ['instance_id', 'instanceId']) ?? undefined,
      /*
        多数据库场景字段。
        这里用 `?? undefined` 把 firstString 的 null 转成可选属性缺失，
        这样 React 组件里可以直接写 `sample.databaseType ? ... : null`。
      */
      databaseType: firstString(record, ['database_type', 'databaseType']) ?? undefined,
      scenarioLabel: firstString(record, ['scenario_label', 'scenarioLabel']) ?? undefined,
      scenarioId: firstString(record, ['scenario_id', 'scenarioId']) ?? undefined,
      symptom: firstString(record, ['symptom']) ?? undefined,
      skill: firstString(record, ['skill', 'skill_name']) ?? undefined,
      scenarioOrder: firstNumber(record, ['scenario_order', 'scenarioOrder']) ?? undefined,
      raw: item as SampleTicket,
    }
  })
}

/**
 * 解析创建任务的返回。
 *
 * 兼容两种形状：
 *   { "task_id": "abc", "status": "queued" }
 *   { "task": { "task_id": "abc", "status": "queued" } }
 *
 * 为什么找不到 task_id 要抛错？
 * 因为后续所有接口都需要 task_id。没有它就没办法轮询，
 * 与其返回一个空字符串让页面莫名其妙，不如立刻给出明确错误。
 *
 * `throw new Error(...)` 会中断当前函数，调用方用 try/catch 捕获。
 */
export function normalizeCreateTask(raw: unknown): CreateTaskResponse {
  const outer = asRecord(raw) ?? {}
  const record = asRecord(outer.task) ?? outer
  const taskId = firstString(record, ['task_id', 'id', 'run_id'])

  if (!taskId) throw new Error('后端未返回 task_id，无法开始轮询任务')

  return {
    task_id: taskId,
    status: firstString(record, ['status']) ?? undefined,
    // 创建响应已经带模型快照时一并保存，方便以后在“创建成功”提示里展示。
    model_provider: firstString(record, ['model_provider', 'modelProvider']),
    model_name: firstString(record, ['model_name', 'modelName']),
  }
}

/* ------------------------------------------------------------------ */
/* 任务详情与事件                                                       */
/* ------------------------------------------------------------------ */

/**
 * 把后端的 error 字段统一成可展示的字符串。
 *
 * 后端可能返回：
 *   "执行超时"
 *   { "message": "执行超时", "type": "timeout" }
 *   { "detail": "..." }
 *   null
 *
 * 如果是对象，优先取 message / detail / error / reason / type；
 * 都没有就格式化整个对象，避免页面丢错误信息。
 */
function normalizeErrorText(value: unknown): string | null {
  if (value === null || value === undefined) return null

  if (typeof value === 'string') {
    const text = value.trim()
    return text || null
  }

  const record = asRecord(value)
  if (record) {
    const message = firstString(record, ['message', 'detail', 'error', 'reason', 'type'])
    return message ?? JSON.stringify(record)
  }

  return String(value)
}

/**
 * 解析任务详情。
 *
 * 注意第一行 `...record` 的写法：
 * 把后端原始字段全部展开到结果对象里，然后再覆盖我们确定要统一的字段。
 * 这样既保留了后端额外字段（调试时能看到），又保证 task_id / status 等字段类型正确。
 *
 * `(typeof ticket === 'string' || asRecord(ticket) ? ticket : null)` 是一个三元表达式：
 * - 如果工单是字符串或对象，保留；
 * - 如果是数字、数组等意外类型，就变成 null。
 *
 * 这里的 `as TicketPayload | null` 是类型断言，配合前面的运行时判断使用。
 */
export function normalizeTask(raw: unknown): TaskDetail {
  const outer = asRecord(raw) ?? {}
  const record = asRecord(outer.task) ?? outer
  const taskId = firstString(record, ['task_id', 'id', 'run_id']) ?? ''
  const status = (firstString(record, ['status', 'state']) ?? 'unknown').toLowerCase()
  const ticket = record.ticket ?? record.ticket_text ?? null
  return {
    ...record,
    task_id: taskId,
    status,
    ticket: (typeof ticket === 'string' || asRecord(ticket) ? ticket : null) as TicketPayload | null,
    current_turn: firstNumber(record, ['current_turn', 'currentTurn', 'turn']),
    stop_reason: firstString(record, ['stop_reason', 'stopReason']),
    topic: record.topic ?? null,
    report: record.report ?? null,
    // 后端 error 可能是字符串，也可能是对象；统一转成可展示的字符串。
    error: normalizeErrorText(record.error ?? record.error_message ?? record.errorMessage),
    /*
      任务快照里的模型字段。
      这两个值是“创建任务时定下来的”，不会随着页面上当前选中的模型变化。
      历史任务迁移后后端也会补上 mock / mock-dba，所以正常都有值；
      读取时仍然允许 null，兼容还没有迁移完的旧数据。
    */
    model_provider: firstString(record, ['model_provider', 'modelProvider']),
    model_name: firstString(record, ['model_name', 'modelName']),
  }
}

/**
 * 解析单条事件。
 *
 * `fallbackSeq = 0` 是“默认参数”：调用方不传时就使用 0。
 * 如果后端某条事件没有 seq，就用它在数组里的位置（从 1 开始）兜底，
 * 避免所有缺失 seq 的事件都变成 0，导致去重时互相覆盖。
 *
 * data 的处理：
 * - 如果 data 是对象，直接用；
 * - 如果 data 是字符串/数字/数组，包成 { value: data }；
 * - 如果 data 是 null/undefined，就保持 null。
 * 这样后续代码始终可以按对象处理 data。
 */
export function normalizeEvent(raw: unknown, fallbackSeq = 0): TaskEvent {
  const record = asRecord(raw) ?? {}
  const seq = firstNumber(record, ['seq', 'sequence', 'id']) ?? fallbackSeq
  const turn = firstNumber(record, ['turn', 'turn_index', 'turnIndex'])
  const dataValue = record.data
  const data = asRecord(dataValue) ?? (dataValue === undefined || dataValue === null ? null : { value: dataValue })
  return {
    seq,
    ts: firstString(record, ['ts', 'timestamp', 'created_at', 'createdAt']) ?? undefined,
    type: firstString(record, ['type', 'event', 'event_type', 'eventType']) ?? 'unknown',
    turn: turn ?? null,
    data,
  }
}

/**
 * 解析事件分页。
 *
 * 三个步骤：
 * 1. 从数组或 { events / items / data } 里取出列表；
 * 2. 转成 TaskEvent，并过滤掉 seq <= afterSeq 的重复事件；
 * 3. 计算 next_seq 和 has_more。
 *
 * 例子：afterSeq = 10，后端返回了 seq 9、10、11 三条（边界重复），
 * 过滤后只剩 11，避免时间线上出现重复记录。
 */
export function normalizeEventPage(raw: unknown, afterSeq: number): EventPage {
  const outer = asRecord(raw)
  const list = Array.isArray(raw)
    ? raw
    : listFrom(raw, ['events', 'items', 'data'])
  const events = list
    .map((item, index) => normalizeEvent(item, index + 1))
    .filter((event) => event.seq > afterSeq)
    .sort((a, b) => a.seq - b.seq)
  const lastSeq = events.length > 0 ? events[events.length - 1].seq : afterSeq
  return {
    events,
    next_seq: firstNumber(outer, ['next_seq', 'nextSeq']) ?? lastSeq,
    has_more: firstBoolean(outer, ['has_more', 'hasMore']) ?? false,
  }
}

/* ------------------------------------------------------------------ */
/* 从事件归并时间线轮次                                                  */
/* ------------------------------------------------------------------ */

/**
 * 合并两次轮询拿到的事件，并按 seq 排序。
 *
 * 为什么需要合并？
 * 轮询是增量拉取的：第一次拿到 1~10，第二次拿到 11~20。
 * 但后端可能在边界上重复返回（例如第二次又返回了 10），
 * 直接用 `[...previous, ...incoming]` 会出现重复记录。
 *
 * 这里用 Map 以 seq 为键去重：
 * - `new Map()` 的键是唯一的；
 * - 后来的同 seq 事件会覆盖先前的（通常内容相同）；
 * - 最后再按 seq 升序排序，保证时间线顺序正确。
 *
 * `Map<number, TaskEvent>` 是泛型写法：键是 number，值是 TaskEvent。
 * `[...bySeq.values()]` 把 Map 里的值展开成数组。
 */
export function mergeEventLists(previous: TaskEvent[], incoming: TaskEvent[]): TaskEvent[] {
  if (incoming.length === 0) return previous
  const bySeq = new Map<number, TaskEvent>()
  for (const event of previous) bySeq.set(event.seq, event)
  for (const event of incoming) bySeq.set(event.seq, event)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

/**
 * 哪些事件属于“某一轮”。
 *
 * 用 `Set<string>` 保存，判断时用 `TURN_EVENT_TYPES.has(type)`，
 * 比数组的 `includes` 更快，语义也更清楚。
 *
 * agent_start / agent_end / topic_updated 不在这里：
 * 它们是任务级事件，不属于具体的某一轮。
 */
const TURN_EVENT_TYPES = new Set([
  'turn_start',
  'model_request',
  'model_response',
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
  'turn_end',
])

/**
 * 从事件流归并出“轮次列表”。
 *
 * 为什么需要这个函数？
 * 后端只返回事件流和 current_turn，没有直接返回 turns 数组。
 * 页面要显示“第 1 轮 / 第 2 轮 / 第 3 轮”，就得自己按 turn 字段分组。
 *
 * 归并规则：
 * 1. 事件带 turn 且 turn > 0：确保这一轮存在，并把它设为“当前轮”；
 * 2. 事件没带 turn 但属于轮次事件：归到当前轮；没有当前轮就从第 1 轮开始；
 * 3. 其他任务级事件：不创建轮次，只更新当前轮的事件计数（如果有）。
 *
 * 返回的轮次按 turn 升序排列。
 *
 * 例子：
 *   turn_start(turn=1)
 *   model_response(turn=1, text='先查慢 SQL')
 *   tool_execution_start(turn=1, tool='get_slow_sql')
 *   tool_execution_end(turn=1, status='ok')
 *   turn_end(turn=1, status='completed')
 *   turn_start(turn=2)
 *   ...
 *
 * 会得到两个 TurnView：第 1 轮（含 1 个工具调用）和第 2 轮。
 */
export function deriveTurns(events: TaskEvent[]): TurnView[] {
  const turns = new Map<number, TurnView>()
  let current: TurnView | null = null

  const ensureTurn = (turnNumber: number, ts?: string): TurnView => {
    const existing = turns.get(turnNumber)
    if (existing) {
      current = existing
      return existing
    }
    const created: TurnView = {
      turn: turnNumber,
      status: 'running',
      started_at: ts,
      assistant_text: '',
      assistant_stop_reason: null,
      tool_calls: [],
      model_request_seen: false,
      model_response_seen: false,
      event_count: 0,
    }
    turns.set(turnNumber, created)
    current = created
    return created
  }

  for (const event of events) {
    const isTurnEvent = TURN_EVENT_TYPES.has(event.type)

    // 显式标注类型是必须的：current 会在 ensureTurn 闭包里被赋值，
    // TypeScript 无法跟踪闭包里的赋值，只会按初始值把 turn 推断成 null。
    let turn: TurnView | null = current
    if (typeof event.turn === 'number' && event.turn > 0) {
      turn = ensureTurn(event.turn, event.ts)
    } else if (isTurnEvent) {
      // 有些事件可能没带 turn；归到当前轮，没有当前轮就从第 1 轮开始。
      turn = current ?? ensureTurn(1, event.ts)
    }
    if (!turn) continue

    turn.event_count += 1
    if (isTurnEvent && !turn.started_at) turn.started_at = event.ts

    const data = event.data ?? {}
    switch (event.type) {
      case 'turn_start':
        turn.status = 'running'
        break
      case 'model_request':
        turn.model_request_seen = true
        break
      case 'model_response':
        applyModelResponse(turn, data)
        break
      case 'message_update':
        applyAssistantPartial(turn, data)
        break
      case 'message_end':
        applyMessageEnd(turn, data)
        break
      case 'tool_execution_start':
        upsertToolCall(turn, data, event.seq, { defaultStatus: 'running', final: false })
        break
      case 'tool_execution_update':
        upsertToolCall(turn, data, event.seq, { defaultStatus: 'running', final: false })
        break
      case 'tool_execution_end':
        upsertToolCall(turn, data, event.seq, { final: true })
        break
      case 'turn_end': {
        /**
         * 后端 turn_end.data 里带了这一轮最终的 assistant message
         * （形状：{ turn, message, tool_results }）。
         * 如果前面没有收到 message_end，这里补一次，避免助手输出为空。
         */
        if (!turn.assistant_text) applyMessageEnd(turn, data)

        const status = firstString(data, ['status', 'stop_reason', 'stopReason'])
        turn.status = normalizeTurnStatus(status)
        turn.ended_at = event.ts ?? turn.ended_at
        break
      }
      default:
        break
    }
  }

  return [...turns.values()].sort((a, b) => a.turn - b.turn)
}

/**
 * 处理 model_response 事件：记录模型正文和停止原因。
 *
 * 后端可能把消息放在两个位置：
 *   { message: { content: '...', stop_reason: 'stop' } }
 *   { content: '...', stop_reason: 'stop' }
 * 这里两种都兼容。
 *
 * `turn` 是对象引用，函数内部修改它的字段，外部的 turns Map 里同一个对象也会变。
 * 这利用了 JavaScript 对象“按引用传递”的特点。
 */
function applyModelResponse(turn: TurnView, data: Record<string, unknown>): void {
  turn.model_response_seen = true
  const message = asRecord(data.message)
  const content = message ? textFromContent(message.content) : textFromContent(data.content ?? data.text)
  if (content) turn.assistant_text = content
  turn.assistant_stop_reason =
    firstString(message, ['stop_reason', 'stopReason']) ??
    firstString(data, ['stop_reason', 'stopReason'])
}

/**
 * 处理 message_update 事件：流式输出时不断刷新正文。
 *
 * 这类事件是“增量/部分”的，先展示出来让时间线看起来是活的；
 * 最终仍以 message_end / model_response 为准，因为它们包含完整内容。
 *
 * 只处理 assistant 消息：user 消息和工具消息不显示在助手正文里。
 */
function applyAssistantPartial(turn: TurnView, data: Record<string, unknown>): void {
  const message = asRecord(data.message) ?? asRecord(data)
  const role = firstString(message, ['role'])
  if (role && role !== 'assistant') return

  /**
   * 后端第 1 步的 message_update 有两块信息：
   * - data.message：当前完整的助手消息；
   * - data.assistant_event：这次流式增量，形如
   *   { type: 'text_delta', delta: '我先确认...', partial: { ... } }。
   *
   * 优先用完整消息，因为它不会重复；如果后端某次没给完整消息，
   * 再退回 assistant_event.partial（也是完整快照）。
   * 最后才用 delta 追加，避免页面在流式过程中“跳字”或重复。
   */
  const content = textFromContent(message?.content ?? data.content ?? data.text)
  if (content) {
    turn.assistant_text = content
    return
  }

  const assistantEvent = asRecord(data.assistant_event)
  if (!assistantEvent) return

  const partialMessage = asRecord(assistantEvent.partial)
  const partialText = textFromContent(partialMessage?.content)
  if (partialText) {
    turn.assistant_text = partialText
    return
  }

  const eventType = firstString(assistantEvent, ['type'])
  const delta = firstString(assistantEvent, ['delta'])
  if (eventType === 'text_delta' && delta) {
    // turn.assistant_text 初始是空字符串；追加 delta 可以把流式片段拼起来。
    turn.assistant_text += delta
  }
}

/**
 * 处理 message_end 事件：用最终消息覆盖流式过程中的临时内容。
 *
 * 为什么不在 message_update 时就定稿？
 * 因为流式片段可能不完整；message_end 才是模型这一条消息的最终版本。
 */
function applyMessageEnd(turn: TurnView, data: Record<string, unknown>): void {
  const message = asRecord(data.message) ?? asRecord(data)
  const role = firstString(message, ['role'])
  if (role && role !== 'assistant') return
  const content = textFromContent(message?.content ?? data.content)
  if (content) turn.assistant_text = content
  const stopReason =
    firstString(message, ['stop_reason', 'stopReason']) ??
    firstString(data, ['stop_reason', 'stopReason'])
  if (stopReason) turn.assistant_stop_reason = stopReason
}

/**
 * 新增或更新一条工具调用（upsert = update + insert）。
 *
 * 一次工具调用通常会产生三条事件：
 *   tool_execution_start  -> 创建调用，状态 running
 *   tool_execution_update -> 更新参数/中间结果
 *   tool_execution_end    -> 写入最终结果、状态、耗时
 *
 * 三条事件必须归到同一个 ToolCallView，否则时间线上会出现三条重复记录。
 * 归并依据是 tool_call_id；后端没给 ID 时，退而求其次按“同名且还在运行”匹配。
 *
 * 参数 options 是一个对象：
 *   { defaultStatus?: string; final: boolean }
 * 这是 TypeScript 的“内联对象类型”：
 * - defaultStatus 可选；
 * - final 必填，表示这条是不是结束事件。
 */
function upsertToolCall(
  turn: TurnView,
  data: Record<string, unknown>,
  seq: number,
  options: { defaultStatus?: string; final: boolean },
): void {
  const name = firstString(data, ['tool_name', 'toolName', 'name', 'tool']) ?? 'unknown_tool'
  let callId = firstString(data, ['tool_call_id', 'toolCallId', 'call_id', 'callId', 'id'])
  if (!callId) {
    // 没有 ID 时优先匹配同名的、还没结束的调用；再不行才生成临时 ID。
    const pending = [...turn.tool_calls].reverse().find(
      (call) => call.tool_name === name && ['running', 'requested'].includes(call.status),
    )
    callId = pending?.tool_call_id ?? `turn-${turn.turn}-call-${turn.tool_calls.length + 1}`
  }

  let call = turn.tool_calls.find((item) => item.tool_call_id === callId)
  if (!call) {
    call = {
      tool_call_id: callId,
      tool_name: name,
      status: options.defaultStatus ?? (options.final ? 'ok' : 'running'),
      is_error: false,
    }
    turn.tool_calls.push(call)
  }

  const args = firstValue(data, ['args', 'arguments', 'params', 'input'])
  if (args !== undefined) call.args = args

  const resultValue = firstValue(data, ['result', 'output', 'content_preview', 'preview', 'content'])
  if (resultValue !== undefined) {
    call.result = resultValue
    call.result_preview = truncateText(textFromContent(resultValue), 4000)
  }

  const resultRecord = asRecord(call.result)

  /*
    工具状态可能藏在三个地方，按“结构化程度从高到低”依次找：

    1. 事件顶层：data.status / data.is_error；
    2. result 顶层：result.status / result.is_error；
    3. result.details.status：后端业务工具自定义的 details 字段。
       真实例子（lock_wait_query）：
         result: {
           content: [{ type: 'text', text: '{"status":"no_data", ...}' }],
           details: { status: 'no_data', sample_count: 0, source: '...' }
         }
       details 是工具自己定义的，不同工具字段不同；
       有就优先用，没有再看下一步。

    4. 最后才回退到解析 content 里的 JSON 文本。
       这一步只为了兼容没有 details 的旧工具/旧后端：
       textFromContent 把 content 数组拼成纯文本，
       parseJsonIfPossible 尝试解析，asRecord 保证结果是对象。
       任何一步失败都会得到 null，不会抛异常。
  */
  const detailsRecord = asRecord(resultRecord?.details)
  const nestedResultRecord = asRecord(parseJsonIfPossible(textFromContent(call.result)))

  const explicitStatus =
    firstString(data, ['status', 'tool_status', 'toolStatus']) ??
    firstString(resultRecord, ['status', 'state']) ??
    firstString(detailsRecord, ['status', 'state']) ??
    firstString(nestedResultRecord, ['status', 'state'])
  const isError =
    firstBoolean(data, ['is_error', 'isError']) ??
    firstBoolean(resultRecord, ['is_error', 'isError']) ??
    firstBoolean(detailsRecord, ['is_error', 'isError']) ??
    firstBoolean(nestedResultRecord, ['is_error', 'isError'])
  if (isError !== undefined) call.is_error = isError
  call.status = normalizeToolStatus(explicitStatus, isError, options.final, call.status)

  const rawRef =
    firstString(data, ['evidence_id', 'evidenceId', 'evidence_ref', 'evidenceRef', 'raw_ref', 'rawRef', 'ref']) ??
    firstString(resultRecord, ['evidence_id', 'evidenceId', 'evidence_ref', 'evidenceRef', 'ref'])
  if (rawRef) call.raw_ref = rawRef

  const duration = firstNumber(data, ['duration_ms', 'durationMs', 'elapsed_ms', 'elapsedMs'])
  if (duration !== null) call.duration_ms = duration
  call.last_seq = seq
}

/**
 * 把后端各种工具状态统一成页面认识的几种。
 *
 * 为什么需要统一？
 * 不同工具/后端可能返回：
 *   success / succeeded / ok / done / completed
 * 它们本质都是“成功”。如果页面为每个词都写一个分支，会很乱。
 *
 * 优先级：
 * 1. 后端明确给了 status：按映射表转；
 * 2. 没给 status 但给了 is_error：true -> error，false -> ok；
 * 3. 结束事件但什么状态都没给：如果之前还在 running，就当作 ok；
 * 4. 其他情况保持原状态。
 *
 * 注意 no_data 是独立状态，不能当成 error，也不能当成“没有异常”：
 * “查了但没查到数据”和“查询失败”是两件事。
 */
function normalizeToolStatus(
  status: string | null,
  isError: boolean | undefined,
  final: boolean,
  previous: string,
): string {
  const value = status?.toLowerCase()
  if (value) {
    if (['ok', 'success', 'succeeded', 'completed', 'done'].includes(value)) return 'ok'
    if (['no_data', 'no_result', 'empty'].includes(value)) return 'no_data'
    if (['error', 'failed', 'failure'].includes(value)) return 'error'
    if (['timeout', 'timed_out', 'timedout'].includes(value)) return 'timeout'
    if (['blocked', 'denied'].includes(value)) return 'blocked'
    if (['cancelled', 'canceled', 'aborted'].includes(value)) return 'cancelled'
    if (['invalid_arguments', 'invalid_args', 'validation_error'].includes(value)) {
      return 'invalid_arguments'
    }
    return value
  }
  if (isError === true) return 'error'
  if (isError === false) return 'ok'
  if (final) return previous === 'running' || previous === 'requested' ? 'ok' : previous
  return previous
}

/**
 * 把后端各种轮次状态统一成页面认识的几种。
 *
 * 没有状态时默认 completed：因为 turn_end 事件本身就表示“这一轮结束了”，
 * 后端没给原因通常就是正常结束。这里不是编造数据，而是根据事件语义做合理默认。
 *
 * 注意：这里的 completed 只代表“本轮结束”，不代表整个任务完成。
 * 后端明确说明 turn_end 是“本轮模型响应结束”，后面往往还会继续下一轮。
 * 页面展示时会把 completed 翻译成“本轮结束”（见 StatusBadge 的 TURN_STATUS），
 * 任务级完成状态只看任务详情或 agent_end。
 */
function normalizeTurnStatus(status: string | null): string {
  const value = status?.toLowerCase()
  if (!value) return 'completed'
  if (['completed', 'complete', 'ok', 'success', 'succeeded', 'done'].includes(value)) return 'completed'
  if (['failed', 'failure', 'error'].includes(value)) return 'failed'
  if (['cancelled', 'canceled', 'aborted'].includes(value)) return 'cancelled'
  if (['timeout', 'timed_out', 'timedout'].includes(value)) return 'timeout'
  return value
}

/* ------------------------------------------------------------------ */
/* Topic / 报告 / 能力 / 证据                                           */
/* ------------------------------------------------------------------ */

/**
 * 把后端 facts 转成 TopicFact[]。
 *
 * facts 可能是：
 *   ['事实一', '事实二']
 *   [{ text: '事实一', evidence_refs: ['ev-1'] }]
 * 两种都兼容。
 *
 * 末尾的 `.filter((item): item is TopicFact => item !== null && item.text !== '')`
 * 是类型谓词：告诉 TypeScript 过滤后的数组元素一定是 TopicFact，不是 null。
 * 这样返回值可以直接声明成 TopicFact[]。
 */
function toTopicFacts(value: unknown): TopicFact[] {
  return asArray(value)
    .map((item) => {
      if (typeof item === 'string') return { text: item, evidence_refs: [] }
      const record = asRecord(item)
      if (!record) return null
      const text =
        firstString(record, ['text', 'statement', 'fact', 'description', 'summary', 'content']) ??
        textFromContent(record)
      const refs = toStringArray(
        firstValue(record, ['evidence_refs', 'evidenceRefs', 'refs', 'evidence', 'citations']),
      )
      const singleRef = firstString(record, ['evidence_id', 'evidenceId', 'ref'])
      return { text, evidence_refs: refs.length > 0 ? refs : singleRef ? [singleRef] : [] }
    })
    .filter((item): item is TopicFact => item !== null && item.text !== '')
}

/**
 * 把后端 candidates（候选原因）转成 TopicCandidate[]。
 *
 * 每个候选原因可能带：
 * - support_refs：支持它的证据；
 * - against_refs：反驳它的证据。
 * 页面会把这两类证据分开显示，避免把“反证”误看成“支持”。
 */
function toTopicCandidates(value: unknown): TopicCandidate[] {
  return asArray(value)
    // 给回调显式标注返回类型，否则 TypeScript 会把每个分支推断成不同的对象形状，
    // 后面的类型谓词 `item is TopicCandidate` 就会因为它对不上而报错。
    .map((item): TopicCandidate | null => {
      if (typeof item === 'string') {
        return { text: item, support_refs: [], against_refs: [] }
      }
      const record = asRecord(item)
      if (!record) return null
      /*
        真实后端的候选原因长这样：
          { key: 'access_path', statement: '……', status: 'supported', evidence: ['ev-1', 'ev-2'] }
        它用的是 `statement`（不是 text）和 `evidence`（不是 support_refs）。
        如果这里不兼容，页面会把整个对象 JSON.stringify 当成正文，证据按钮也会消失。
      */
      const text =
        firstString(record, [
          'text',
          'statement',
          'candidate',
          'hypothesis',
          'cause',
          'description',
          'summary',
        ]) ?? textFromContent(record)
      return {
        text,
        status: firstString(record, ['status', 'state', 'verdict']) ?? undefined,
        support_refs: toStringArray(
          firstValue(record, [
            'support_refs',
            'supportRefs',
            'supporting_evidence',
            'evidence_refs',
            // `evidence` 是真实后端字段，值是字符串数组，和 support_refs 语义相同。
            'evidence',
          ]),
        ),
        against_refs: toStringArray(
          firstValue(record, ['against_refs', 'againstRefs', 'opposing_evidence', 'counter_evidence']),
        ),
      }
    })
    .filter((item): item is TopicCandidate => item !== null && item.text !== '')
}

/**
 * 把 Topic 的 scope 转成一行可读文本。
 *
 * 为什么需要这个函数？
 * - 页面最初按“scope 是字符串”来写，但真实后端返回的是对象：
 *     { ticket_id, instance_id, database, time_range: { start, end }, mock }
 *   如果仍然用 firstString(record, ['scope'])，对象会被判定为“不是字符串”，
 *   结果整段排查范围在页面上凭空消失。
 * - 组件只负责显示，不适合在 JSX 里堆一堆字段判断，所以统一在这里转成文本。
 *
 * 支持三种输入，按“从常见到兜底”排列：
 * 1. 字符串：后端某些版本可能直接给“实例 A，最近 1 小时”，trim 后原样返回；
 * 2. 对象：挑认识的字段拼成“工单 … · 实例 … · 库 … · 时间 … · 模拟数据”；
 * 3. 其他对象：一个认识的字段都没有时，用 JSON.stringify 兜底，
 *    保证联调时能看见后端确实给了内容，而不是静默丢掉。
 *
 * 例子：
 *   formatTopicScope({
 *     ticket_id: 'TCK-1',
 *     instance_id: 'db-mysql-001',
 *     database: 'shop_order',
 *     time_range: { start: '2026-10-29T10:00:00+08:00', end: '2026-10-29T11:00:00+08:00' },
 *     mock: true,
 *   })
 *   -> '工单 TCK-1 · 实例 db-mysql-001 · 库 shop_order · 时间 10/29 10:00:00 ~ 10/29 11:00:00 · 模拟数据'
 */
function formatTopicScope(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string') return value.trim()

  const record = asRecord(value)
  if (!record) {
    /*
      数字、布尔等非对象值：直接转字符串。
      `String(value)` 对 unknown 是安全的，不需要先判断具体类型。
    */
    return String(value)
  }

  /*
    `parts: string[]` 显式声明成字符串数组。
    如果写成 `const parts = []`，TypeScript 在严格模式下会推断成 never[]，
    后面 push 字符串就会报“string 不能赋给 never”。
  */
  const parts: string[] = []

  const ticketId = firstString(record, ['ticket_id', 'ticketId'])
  if (ticketId) parts.push(`工单 ${ticketId}`)

  const instanceId = firstString(record, ['instance_id', 'instanceId', 'instance'])
  if (instanceId) parts.push(`实例 ${instanceId}`)

  const database = firstString(record, ['database', 'db', 'schema', 'schema_name', 'schemaName'])
  if (database) parts.push(`库 ${database}`)

  /*
    time_range 是嵌套对象，不能用 firstString 直接读（它不是字符串）。
    先用 asRecord 拿到内层对象，再分别读 start / end。
    兼容 from/to、begin/finish 这些常见别名。
  */
  /*
    优先读嵌套的 time_range 对象。
    如果 scope 本身就是时间范围（{ start, end }），asRecord(...) 会得到 null，
    这时用 `in` 运算符判断“键是否存在”，把 record 自己当成时间范围。
    `'start' in record` 只检查键，不关心值是 null 还是空字符串，正合适。
  */
  const timeRange =
    asRecord(firstValue(record, ['time_range', 'timeRange'])) ??
    ('start' in record || 'from' in record || 'begin' in record ? record : null)
  if (timeRange) {
    const start = firstString(timeRange, ['start', 'from', 'begin'])
    const end = firstString(timeRange, ['end', 'to', 'finish'])
    if (start || end) {
      // formatDateTime 对 null/undefined 返回 '—'，所以只有一端时也能正常显示。
      parts.push(`时间 ${formatDateTime(start)} ~ ${formatDateTime(end)}`)
    }
  }

  /*
    mock 只向后端要 true 的情况。
    如果后端明确给 false，也不写“真实数据”——因为前端无法证明数据真实，
    只能证明后端没有标记为模拟。
  */
  if (firstBoolean(record, ['mock', 'is_mock', 'isMock']) === true) {
    parts.push('模拟数据')
  }

  if (parts.length === 0) {
    /*
      兜底：后端换了字段名，前端一个都不认识。
      这里返回紧凑 JSON 而不是空字符串，避免“范围”整块消失。
      `JSON.stringify(record)` 不传缩进参数，得到一行文本，适合放在范围行里。
    */
    return JSON.stringify(record)
  }

  // `Array.prototype.join(' · ')` 用中点分隔各段，比逗号更容易区分字段。
  return parts.join(' · ')
}

/**
 * 解析 Topic。
 *
 * Topic 是 Agent“当前在想什么”的持久化记录，可能以多种形式返回：
 * - 字符串（例如一段 JSON 文本，或一句问题）；
 * - 对象；
 * - null（任务还没生成 Topic）。
 *
 * 解析顺序：
 * 1. null / 空字符串 -> null；
 * 2. 字符串 -> 先尝试 parseJsonIfPossible；
 * 3. 解析后还是字符串 -> 把它当成 question，其余字段留空；
 * 4. 对象 -> 按候选字段名读取。
 *
 * 页面拿到 null 时会显示“Topic 尚未生成”，而不是编一个空 Topic。
 */
export function normalizeTopic(raw: unknown): TopicView | null {
  if (raw === null || raw === undefined || raw === '') return null
  // 显式写 unknown：不写的话，TypeScript 会按前面的判断把 raw 收窄成 {}，
  // 后面再赋一个字符串就会报“unknown 不能赋给 {}”。
  let value: unknown = raw
  if (typeof value === 'string') value = parseJsonIfPossible(value)
  if (typeof value === 'string') {
    return {
      question: value,
      scope: '',
      facts: [],
      candidates: [],
      open_questions: [],
      next_steps: [],
      attempted_tools: [],
      raw,
    }
  }
  const record = asRecord(value)
  if (!record) return null

  return {
    question:
      firstString(record, ['question', 'current_question', 'currentQuestion', 'problem', 'title', 'issue']) ??
      '',
    /*
      注意这里用的是 formatTopicScope()，不是 firstString()。
      真实后端的 scope 是对象；firstString 只认字符串，会让整段范围信息丢失。
      函数内部同时兼容字符串和对象两种形态。
    */
    scope: formatTopicScope(
      firstValue(record, ['scope', 'range', 'resource_scope', 'resourceScope', 'time_range', 'timeRange']),
    ),
    facts: toTopicFacts(firstValue(record, ['facts', 'known_facts', 'knownFacts', 'confirmed_facts', 'confirmedFacts', 'observations'])),
    candidates: toTopicCandidates(firstValue(record, ['candidates', 'hypotheses', 'possible_causes', 'possibleCauses'])),
    open_questions: toStringArray(
      firstValue(record, ['open_questions', 'openQuestions', 'open_items', 'openItems', 'pending_questions', 'pendingQuestions']),
    ),
    next_steps: toStringArray(
      firstValue(record, ['next_steps', 'nextSteps', 'next_actions', 'nextActions', 'todo', 'todos']),
    ),
    attempted_tools: toStringArray(
      firstValue(record, ['attempted_tools', 'attemptedTools', 'tried_tools', 'triedTools']),
    ),
    version: firstNumber(record, ['version', 'revision']),
    updated_at: firstString(record, ['updated_at', 'updatedAt', 'ts']),
    raw,
  }
}

function toStringArray(value: unknown): string[] {
  return asArray(value)
    .map((item) => {
      if (typeof item === 'string') return item
      if (typeof item === 'number' || typeof item === 'boolean') return String(item)
      const record = asRecord(item)
      if (!record) return ''
      return (
        firstString(record, ['text', 'statement', 'summary', 'description', 'content', 'ref', 'evidence_id', 'id']) ??
        textFromContent(record)
      )
    })
    .filter((item) => item !== '')
}

/**
 * 把报告里的证据引用转成 ReportEvidence[]。
 *
 * 证据可能写成：
 *   ['ev-1', 'ev-2']
 *   [{ ref: 'ev-1', note: '慢日志' }]
 * 两种都兼容。`note` 可选，没有就不显示。
 */
function toReportEvidence(value: unknown): ReportEvidence[] {
  return asArray(value)
    .map((item) => {
      if (typeof item === 'string') return { ref: item }
      const record = asRecord(item)
      if (!record) return null
      const ref =
        firstString(record, ['ref', 'evidence_id', 'evidenceId', 'id', 'citation']) ??
        textFromContent(record)
      const note = firstString(record, ['note', 'summary', 'description', 'text']) ?? undefined
      return { ref, note }
    })
    .filter((item): item is ReportEvidence => item !== null && item.ref !== '')
}

/**
 * 解析最终报告。
 *
 * 这是兼容性最复杂的一个函数，因为报告可能是：
 * 1. 纯字符串（markdown）；
 * 2. JSON 字符串（先 parseJsonIfPossible）；
 * 3. { markdown, structured }（后端 v0）；
 * 4. 结构化对象：{ summary, evidence, recommendations, ... }；
 * 5. { report: {...} } 再包一层；
 * 6. null。
 *
 * 无论哪种，最终都返回 FinalReport；完全没内容时返回 null。
 *
 * 注意 `markdown` 字段始终存在（可能是空字符串）：
 * 页面可以稳定地判断 `report.markdown`，不用写 `report.markdown ?? ''`。
 */
export function normalizeReport(raw: unknown): FinalReport | null {
  if (raw === null || raw === undefined || raw === '') return null
  // 显式写 unknown：不写的话，TypeScript 会按前面的判断把 raw 收窄成 {}，
  // 后面再赋一个字符串就会报“unknown 不能赋给 {}”。
  let value: unknown = raw
  if (typeof value === 'string') value = parseJsonIfPossible(value)
  if (typeof value === 'string') {
    return {
      markdown: value,
      summary: value,
      evidence: [],
      recommendations: [],
      verification: [],
      limitations: [],
      raw,
    }
  }
  const outer = asRecord(value)
  if (!outer) {
    const text = textFromContent(value)
    return {
      markdown: text,
      summary: text,
      evidence: [],
      recommendations: [],
      verification: [],
      limitations: [],
      raw,
    }
  }
  // 兼容 {report: {...}} 这种再包一层的情况。
  const record = asRecord(outer.report) ?? outer
  // 后端 v0：{markdown: string, structured: object|null}。
  const markdown = firstString(record, ['markdown', 'content', 'text']) ?? ''
  const structured = asRecord(record.structured)
  const structuredSource = structured ?? record
  const summary =
    firstString(structuredSource, ['summary', 'content', 'diagnosis', 'conclusion', 'answer', 'text']) ??
    firstString(record, ['summary', 'content', 'diagnosis', 'conclusion', 'answer', 'text']) ??
    markdown
  const evidence = toReportEvidence(firstValue(structuredSource, ['evidence', 'evidence_refs', 'evidenceRefs', 'references']))
  const recommendations = toStringArray(
    firstValue(structuredSource, ['recommendations', 'suggestions', 'actions', 'advice']),
  )
  const verification = toStringArray(
    firstValue(structuredSource, ['verification', 'validation', 'how_to_verify', 'howToVerify']),
  )
  const limitations = toStringArray(
    firstValue(structuredSource, ['limitations', 'caveats', 'uncertainties', 'open_questions', 'openQuestions']),
  )

  /**
   * 判断报告是否真的有内容。
   *
   * 为什么要判断？
   * 任务详情里的 report 字段在报告生成前可能是 `{}`，
   * 或者是 `{markdown: "", structured: null}` 这种“只有壳”的对象。
   * 如果直接返回一个 FinalReport，页面会显示一份空报告，
   * 而且 useTask 会误以为“任务详情里已经带报告”，不再请求 /report。
   *
   * 这种情况必须返回 null，让调用方继续走 /report 接口或显示空状态。
   */
  const hasContent =
    markdown !== '' ||
    summary !== '' ||
    evidence.length > 0 ||
    recommendations.length > 0 ||
    verification.length > 0 ||
    limitations.length > 0

  if (!hasContent) {
    /**
     * 只有 markdown / structured 两个键的对象，说明它只是后端 v0 的空壳；
     * 有其他未知字段时，退一步把整个对象当文本展示，至少不丢信息。
     */
    const onlyWrapperKeys = Object.keys(record).every(
      (key) => key === 'markdown' || key === 'structured',
    )
    if (onlyWrapperKeys) return null

    const fallbackText = textFromContent(record)
    if (!fallbackText || fallbackText === '{}') return null

    return {
      markdown: '',
      summary: fallbackText,
      evidence,
      recommendations,
      verification,
      limitations,
      raw,
    }
  }

  return {
    markdown,
    // summary 在找不到摘要字段时已经回退到 markdown；这里不再用整个对象兜底，
    // 避免把 {recommendations: [...]} 这类结构化对象打印成一屏 JSON。
    summary,
    evidence,
    recommendations,
    verification,
    limitations,
    raw,
  }
}

function toCapabilityList(value: unknown): CapabilityView[] {
  return asArray(value)
    // 显式返回类型，保证每个分支的形状一致，类型谓词才能正确收窄。
    .map((item): CapabilityView | null => {
      if (typeof item === 'string') return { name: item, raw: item }
      const record = asRecord(item)
      if (!record) return null
      const name = firstString(record, ['name', 'id', 'tool_name', 'skill_name', 'title'])
      if (!name) return null
      return {
        name,
        // 后端能力目录给的是 {name, label, description, ...}；
        // label 是人类可读名称，没有时就留 undefined，页面会退回 name。
        label: firstString(record, ['label', 'display_name', 'displayName', 'title']) ?? undefined,
        description: firstString(record, ['description', 'summary', 'purpose', 'when_to_use']) ?? undefined,
        raw: item,
      }
    })
    .filter((item): item is CapabilityView => item !== null)
}

/**
 * 解析一个模型提供方列表（GET /api/models 的 providers）。
 *
 * 后端的每一项大致长这样：
 *   {
 *     "provider": "deepseek",
 *     "label": "DeepSeek",
 *     "description": "调用 DeepSeek 的 OpenAI 兼容接口…",
 *     "default_model": "deepseek-flash",
 *     "models": ["deepseek-flash", "deepseek-v4-pro"],
 *     "available": true,
 *     "reason": null
 *   }
 *
 * 兼容策略：
 * - provider 是提交任务时真正要用的标识，没有它这一项就没法用，直接过滤掉；
 * - available 缺失时按 true 处理，避免老后端没这个字段时整页都不能选模型；
 * - models 为空但给了 default_model 时，把默认模型补进列表，
 *   否则下拉框会是空的，用户看得到“默认模型”却选不了。
 */
function toModelProviderList(value: unknown): ModelProviderView[] {
  return asArray(value)
    // 显式返回类型：各分支要么返回对象，要么返回 null，后面再用类型谓词过滤。
    .map((item): ModelProviderView | null => {
      const record = asRecord(item)
      if (!record) return null

      const provider = firstString(record, ['provider', 'id', 'name'])
      if (!provider) return null

      /*
        `new Set(...)` 顺手去重：如果后端把同一个模型名写了两遍，
        下拉框会出现两个 value 相同的 option，React 会报 key 重复。
      */
      const modelNames = [...new Set(toStringArray(firstValue(record, ['models', 'model_list', 'modelList'])))]
      const defaultModel =
        firstString(record, ['default_model', 'defaultModel']) ?? modelNames[0] ?? ''

      /*
        用 Set 判断默认模型是否已经在列表里。
        Set 的查找是 O(1)，比 `modelNames.includes(...)` 更适合长列表；
        这里列表很短，用 Set 主要是语义清楚：去重 + 判断“有没有”。

        举例：models = ['deepseek-flash']，default_model = 'deepseek-v4-pro'
        最终得到 ['deepseek-v4-pro', 'deepseek-flash']，
        保证默认值一定出现在下拉框里。
      */
      const seen = new Set(modelNames)
      const models =
        defaultModel && !seen.has(defaultModel) ? [defaultModel, ...modelNames] : modelNames

      return {
        provider,
        label:
          firstString(record, ['label', 'display_name', 'displayName', 'title']) ?? undefined,
        description:
          firstString(record, ['description', 'summary', 'purpose']) ?? undefined,
        default_model: defaultModel,
        models,
        available: firstBoolean(record, ['available', 'is_available', 'isAvailable']) ?? true,
        reason: firstString(record, ['reason', 'unavailable_reason', 'unavailableReason']),
        raw: item,
      }
    })
    .filter((item): item is ModelProviderView => item !== null)
}

/**
 * 解析 GET /api/models。
 *
 * 正常形状：
 *   { "default_provider": "mock", "providers": [...] }
 *
 * 也兼容直接给数组： [ { provider: ... }, ... ]
 * 这时没有 default_provider，就挑第一个 available=true 的项。
 *
 * 注意：返回的 default_provider 只用于“新建任务时默认选中谁”，
 * 不能拿去回填历史任务。历史任务用哪个模型，要看任务快照里的
 * model_provider / model_name。
 */
export function normalizeModels(raw: unknown): ModelsView {
  const record = asRecord(raw) ?? {}
  const providers = toModelProviderList(
    Array.isArray(raw) ? raw : firstValue(record, ['providers', 'model_providers', 'modelProviders']),
  )

  const requestedDefault = firstString(record, ['default_provider', 'defaultProvider'])
  /*
    这里把 `requestedDefault !== null` 和“列表里真的有这个 provider”写在一个条件里。
    两个条件同时成立时，TypeScript 才能稳定地把 requestedDefault 收窄成 string；
    如果拆成单独的布尔变量，有时候编译器不会跟着收窄，就不得不写 `as string` 断言。
  */
  const defaultProvider =
    requestedDefault !== null && providers.some((item) => item.provider === requestedDefault)
      ? requestedDefault
      : (providers.find((item) => item.available)?.provider ?? providers[0]?.provider ?? '')

  return {
    default_provider: defaultProvider,
    providers,
    raw,
  }
}

/**
 * 解析能力目录。
 *
 * 后端可能返回：
 *   { skills: [...], tools: [...] }
 *   { skill_list: [...], tool_list: [...] }
 * 两种都兼容。缺失的列表一律变成空数组，页面显示空状态。
 *
 * 新版后端还会带一个 models 字段，形状和 GET /api/models 一样。
 * 这里顺手解析出来，页面可以在 /api/models 请求失败时复用它。
 */
export function normalizeCapabilities(raw: unknown): CapabilitiesView {
  const record = asRecord(raw) ?? {}
  const modelsValue = firstValue(record, ['models', 'model_catalog', 'modelCatalog'])
  return {
    skills: toCapabilityList(firstValue(record, ['skills', 'skill_list', 'skillList'])),
    tools: toCapabilityList(firstValue(record, ['tools', 'tool_list', 'toolList'])),
    // 老版本后端没有 models 字段：保持 null，页面会跳过“复用能力目录”的分支。
    models: modelsValue === undefined || modelsValue === null ? null : normalizeModels(modelsValue),
  }
}

/**
 * 解析证据列表。
 *
 * 证据条目可能是字符串（只有 ID），也可能是对象。
 * `size` 可能来自 size / bytes / total_chars / chars，
 * 这里不区分单位，统一展示成数字；页面会标注“大小/字符数”而不是假装知道单位。
 */
export function normalizeEvidenceList(raw: unknown): EvidenceItemView[] {
  const list = Array.isArray(raw) ? raw : listFrom(raw, ['evidence', 'items', 'data'])
  return list
    // 显式返回类型，避免各分支推断出的对象形状不一致导致类型谓词报错。
    .map((item, index): EvidenceItemView | null => {
      if (typeof item === 'string') {
        return { evidence_id: item, raw: item }
      }
      const record = asRecord(item)
      if (!record) return null
      const evidenceId =
        firstString(record, ['evidence_id', 'evidenceId', 'id', 'ref', 'path']) ?? `evidence-${index + 1}`
      return {
        evidence_id: evidenceId,
        tool_name: firstString(record, ['tool_name', 'toolName', 'tool']) ?? undefined,
        tool_call_id: firstString(record, ['tool_call_id', 'toolCallId', 'call_id']) ?? undefined,
        // 后端证据列表实际字段是 size_chars；同时兼容旧命名。
        size: firstNumber(record, [
          'size_chars',
          'sizeChars',
          'size',
          'bytes',
          'total_chars',
          'totalChars',
          'chars',
        ]),
        truncated: firstBoolean(record, ['truncated', 'is_truncated', 'isTruncated']),
        /*
          真实后端证据条目的字段是 is_error。
          只读布尔值，不把字段名叫 `error` 的字符串/对象误当成标志位：
          firstBoolean 内部会判断 typeof === 'boolean'，不是布尔就返回 undefined。
        */
        is_error: firstBoolean(record, ['is_error', 'isError']),
        created_at: firstString(record, ['created_at', 'createdAt', 'ts', 'timestamp']) ?? undefined,
        raw: item,
      }
    })
    .filter((item): item is EvidenceItemView => item !== null)
}

/**
 * 解析证据预览片段。
 *
 * 参数里的 `requestedOffset` / `requestedLimit` 是前端请求时用的值。
 * 如果后端没有在响应里重复返回 offset / limit，就用请求值兜底，
 * 这样页面仍然能显示“当前看的是第几段”。
 *
 * `total_chars` 可能来自 total_chars / total / size / bytes。
 * 如果后端把 size 当字节数，这个值可能不是字符数；页面会尽量避免把单位写死。
 */
export function normalizeEvidenceChunk(
  raw: unknown,
  evidenceId: string,
  requestedOffset: number,
  requestedLimit: number,
): EvidenceChunk {
  if (typeof raw === 'string') {
    return {
      evidence_id: evidenceId,
      content: raw,
      offset: requestedOffset,
      limit: requestedLimit,
      total_chars: raw.length,
      truncated: raw.length >= requestedLimit,
      raw,
    }
  }
  const outer = asRecord(raw) ?? {}
  const record = asRecord(outer.evidence) ?? outer
  /*
    证据正文用 firstRawString，不用 firstString：
    后者会 trim 首尾空白，导致正文少字符、分页偏移重叠。
    详见 firstRawString 的注释。
  */
  const content =
    firstRawString(record, ['content', 'text', 'preview', 'data']) ??
    textFromContent(firstValue(record, ['content', 'text', 'preview', 'data']) ?? record)
  return {
    evidence_id: firstString(record, ['evidence_id', 'evidenceId', 'id', 'ref']) ?? evidenceId,
    content,
    offset: firstNumber(record, ['offset', 'start']) ?? requestedOffset,
    limit: firstNumber(record, ['limit', 'size']) ?? requestedLimit,
    total_chars: firstNumber(record, ['total_chars', 'totalChars', 'total', 'size', 'bytes']),
    truncated: firstBoolean(record, ['truncated', 'is_truncated', 'isTruncated']),
    raw,
  }
}

/* ------------------------------------------------------------------ */
/* 状态判断                                                            */
/* ------------------------------------------------------------------ */

/**
 * 任务终态集合：到了这些状态就不会再变化，轮询可以停。
 *
 * 注意 `interrupted` 也算终态：
 * 后端进程重启/任务被中断后，这个任务不会再继续跑，页面应停止轮询并提示。
 */
const TERMINAL_STATUSES = new Set([
  'completed',
  'complete',
  'succeeded',
  'success',
  'failed',
  'cancelled',
  'canceled',
  'timeout',
  'interrupted',
  'error',
  'done',
])

/**
 * 判断任务是否已经结束。
 *
 * `status: string | null | undefined` 表示调用方可以传字符串，也可以传 null/undefined。
 * `!!status` 先把值转成布尔：空字符串 / null / undefined 都变成 false。
 * 后面的 `status.toLowerCase()` 只有在 status 为真时才会执行（&& 短路）。
 *
 * 例子：
 *   isTerminalStatus('completed') -> true
 *   isTerminalStatus('RUNNING')   -> false（先转小写，再查表）
 *   isTerminalStatus(null)        -> false
 */
export function isTerminalStatus(status: string | null | undefined): boolean {
  return !!status && TERMINAL_STATUSES.has(status.toLowerCase())
}

/**
 * 从工单里取一个短标题。
 *
 * 工单可能是：
 * - 字符串：取第一行，截断到 80 字符；
 * - 对象：优先取 title / name / summary / subject，再退到正文第一行；
 * - 都没有：返回“DBA 工单”。
 *
 * 注意 `ticket.split('\n')[0] ?? ticket` 里的 `??`：
 * 空字符串的第一行是 ''，不是 null，所以这里其实不会走 `?? ticket`。
 * 保留它只是防御极端情况，实际空字符串会返回空标题，页面还有兜底文案。
 */
export function ticketTitle(ticket: TicketPayload | null | undefined): string {
  if (typeof ticket === 'string') return truncateText(ticket.split('\n')[0] ?? ticket, 80)
  const record = asRecord(ticket)
  return (
    firstString(record, ['title', 'name', 'summary', 'subject']) ??
    firstString(record, ['text', 'description', 'ticket_text'])?.split('\n')[0] ??
    'DBA 工单'
  )
}

/**
 * 取工单正文。
 *
 * 用于两类场景：
 * - 任务详情里展开查看原始工单；
 * - 将来如果需要把工单回填到输入框。
 *
 * 对象工单里可能字段叫 ticket_text / text / description / content，
 * 这里按这个顺序找第一个非空字符串。
 */
export function ticketText(ticket: TicketPayload | null | undefined): string {
  if (typeof ticket === 'string') return ticket
  const record = asRecord(ticket)
  return firstString(record, ['ticket_text', 'text', 'description', 'content']) ?? ''
}

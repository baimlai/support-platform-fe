/**
 * ============================================================================
 * 后端契约 v0 的类型声明
 * ============================================================================
 *
 * 这个文件只做一件事：描述“后端接口返回的数据长什么样”。
 *
 * 为什么不直接在组件里写后端字段？
 * 因为后端契约还在 v0，字段名随时可能微调。把所有“后端长什么样”的类型集中在这里，
 * 页面组件只依赖我们在 normalize.ts 里整理好的页面模型。以后后端改字段，
 * 优先只改 types.ts / normalize.ts，页面组件不用大改。
 *
 * 类型写法约定：
 * - 结构不固定的后端字段用 `unknown`，不用 `any`；用之前必须判断类型，判断逻辑集中在 normalize.ts。
 * - 可选字段用 `?`（字段可以不存在）；可能为空的字段用 `| null`（字段存在但值是 null）。
 * - 联合类型 `|` 用来列出已知取值，末尾保留 `(string & {})` 是为了兼容后端以后新增状态。
 */

/**
 * 后端任务状态。
 *
 * 这里列出的是我们目前知道的取值；最后又加了 `| string`，
 * 是因为后端以后可能新增状态（比如 `paused`），前端不应该因此编译失败。
 *
 * 小例子：
 *   const ok: TaskStatus = 'running'   // ✅ 合法
 *   const bad: TaskStatus = 'whatever' // ⚠️ 因为加了 | string，这里也不会报错
 *
 * 注意：`| string` 会削弱自动补全和检查。如果你希望严格限制取值，
 * 可以去掉最后的 `| string`。当前阶段为了兼容后端，先保留。
 */
export type TaskStatus =
  | 'queued'
  | 'pending'
  | 'running'
  | 'completed'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'interrupted'
  | 'error'
  | 'unknown'
  | (string & {})
// ↑ `(string & {})` 是另一种“保留自动补全的同时允许任意字符串”的写法。
//   它和直接写 `| string` 效果接近，但编辑器通常还能提示前面的已知值。

/**
 * 工单可能是纯文本，也可能是后端整理后的对象；两种都兼容。
 *
 * `TicketPayload` 是一个“类型别名”（type alias），
 * 意思是“工单这个值，要么是 string，要么是 Record<string, unknown>”。
 */
export type TicketPayload = string | Record<string, unknown>

/**
 * 后端样例工单的原始形状。
 *
 * 注意每个字段都带 `?`，因为后端可能只返回其中一部分。
 * 例如后端可能返回：
 *   { "sample_id": "slow-sql-1", "title": "慢 SQL 工单", "mock": true }
 * 也可能返回：
 *   { "id": "slow-sql-1", "name": "慢 SQL 工单" }
 * 所以前端不能假设某个字段一定存在。
 */
export interface SampleTicket {
  sample_id?: string
  id?: string
  name?: string
  title?: string
  ticket_text?: string
  text?: string
  description?: string
  /**
   * 多数据库场景的展示字段。
   *
   * 这些字段是后端 `/api/samples` 新增的，不是每个历史样例都有：
   * - database_type：mysql / postgresql / redis / mongodb / elasticsearch / clickhouse；
   * - scenario_id / scenario_label：场景标识和中文标题；
   * - symptom：工单现象，比 description 更适合放在标签里；
   * - skill：该样例应使用的 Skill 名称；
   * - scenario_order：后端已按它排序，前端只做兜底展示。
   */
  database_type?: string
  scenario_id?: string
  scenario_label?: string
  symptom?: string
  skill?: string
  scenario_order?: number
  /**
   * 索引签名：允许后端返回我们还没预料到的字段。
   * 例如后端新增 `instance_id`、`mock`，不需要改这个 interface 也能通过类型检查。
   */
  [key: string]: unknown
}

/**
 * 页面使用的样例：把后端各种字段名统一成 id / label / text。
 *
 * 这里没有 `?`，说明这些字段在“页面模型”里必须存在。
 * normalizeSamples() 会负责把缺失值补成空字符串或 false，
 * 这样组件里就不用到处写 `sample.title ?? sample.name ?? ...`。
 */
export interface SampleView {
  /** 样例唯一 ID，创建任务时作为 sample_id 传给后端。 */
  id: string
  /** 展示给用户看的名字。 */
  label: string
  /** 样例工单正文，用于在页面上预览。 */
  text: string
  /** 后端标记的模拟样例；页面会显示“模拟”提示，避免误认为真实工单。 */
  mock: boolean
  /** 样例关联的数据库实例（如果后端提供）。 */
  instanceId?: string
  /** 数据库类型，例如 mysql、postgresql、redis。 */
  databaseType?: string
  /** 场景中文标题，例如“Redis 单分片热 Key 导致延迟升高”。 */
  scenarioLabel?: string
  /** 场景标识，便于调试和以后做筛选。 */
  scenarioId?: string
  /** 工单现象摘要，用于样例下拉框的辅助说明。 */
  symptom?: string
  /** 该样例对应的 Skill 名称；后端会自动按工单选择，前端只展示。 */
  skill?: string
  /** 后端排序值；前端只保留，不重新排序。 */
  scenarioOrder?: number
  /** 保留原始返回值，方便调试或以后展示更多字段。 */
  raw: SampleTicket | string
}

/**
 * 创建任务的请求体。
 *
 * 字段都是可选的，因为前端允许：
 * - 只选样例：{ sample_id: 'slow-sql-1' }
 * - 只写手工工单：{ ticket_text: '...' }
 * - 两者都带：由后端决定优先级
 *
 * 模型字段是后加的可选项：
 * - 不传 model_provider / model_name：后端使用服务端默认模型；
 * - 传了就必须成对出现，避免“只指定提供方、没指定模型”这种半截配置。
 */
export interface CreateTaskInput {
  sample_id?: string
  ticket_text?: string
  tenant_id?: string
  /** 模型提供方，例如 mock、deepseek；对应 GET /api/models 里的 provider。 */
  model_provider?: string
  /** 具体模型名，例如 mock-dba、deepseek-flash。 */
  model_name?: string
}

/**
 * GET /api/models 里的一个模型提供方。
 *
 * 用 interface 而不是 type，是因为它描述的是“一个对象有哪些字段”，
 * interface 更适合这种稳定的数据结构，也方便以后 extends 扩展。
 */
export interface ModelProviderView {
  /** 后端内部标识，提交任务时作为 model_provider。 */
  provider: string
  /** 展示名，例如“模拟模型”“DeepSeek”；后端没给时页面退回 provider。 */
  label?: string
  /** 这个提供方的说明，展示在下拉框下方，帮助用户理解它是什么。 */
  description?: string
  /** 切换到这个提供方时默认选中的模型名。 */
  default_model: string
  /** 这个提供方支持的模型列表；页面用它渲染模型下拉框。 */
  models: string[]
  /**
   * 当前是否可用。
   * 例如 DeepSeek 没配置 API Key 时 available=false，
   * 页面必须置灰，并把 reason 展示给用户，而不是让用户提交后才报错。
   */
  available: boolean
  /** 不可用原因，例如“未配置 DEEPSEEK_API_KEY”；可用时为 null。 */
  reason: string | null
  /** 保留原始对象，方便调试或以后展示更多字段。 */
  raw: unknown
}

/**
 * GET /api/models 的页面模型。
 *
 * default_provider 是服务端建议的默认值。页面首次渲染下拉框时优先选它，
 * 但任务详情里“本次用了什么模型”必须看任务快照，不能用这个默认值回填。
 */
export interface ModelsView {
  default_provider: string
  providers: ModelProviderView[]
  raw: unknown
}

/** POST /api/tasks 的返回。`status` 可选，因为有的后端只返回 task_id。 */
export interface CreateTaskResponse {
  task_id: string
  status?: string
  /** 创建瞬间使用的模型提供方（新契约返回）。 */
  model_provider?: string | null
  /** 创建瞬间使用的模型名（新契约返回）。 */
  model_name?: string | null
}

/**
 * GET /api/tasks/{task_id} 的原始返回。
 *
 * 最后一行 `[key: string]: unknown` 允许后端附带额外字段。
 * 注意：因为有了索引签名，`detail.anything` 在类型上都是 unknown，
 * 使用前仍然要做类型判断（normalizeTask 里就是这么做的）。
 */
export interface TaskDetail {
  task_id: string
  status: string
  /** 工单可能是字符串，也可能是对象，还可能后端暂时没返回。 */
  ticket?: TicketPayload | null
  /** 当前进行到第几轮；任务还没开始时可能为 null。 */
  current_turn?: number | null
  /** 停止原因：completed / max_turns / cancelled / error / interrupted 等。 */
  stop_reason?: string | null
  /** Topic 的结构由后端决定，这里先保持 unknown，交给 normalizeTopic 解析。 */
  topic?: unknown
  /** 报告同理：可能是字符串、对象，或者 null。 */
  report?: unknown
  /** 任务级错误信息。 */
  error?: string | null
  /**
   * 这个任务实际使用的模型提供方。
   *
   * 注意：它属于“任务快照”，创建时就固定了。
   * 页面展示历史任务时必须读这两个字段，不能拿当前表单里选中的模型去回填，
   * 否则用户会误以为旧任务也是用新选的模型跑的。
   */
  model_provider?: string | null
  /** 这个任务实际使用的模型名，例如 deepseek-flash。 */
  model_name?: string | null
  [key: string]: unknown
}

/**
 * 一条运行事件。后端契约 v0：{seq, ts, type, turn, data}。
 *
 * `data` 是事件的具体内容，不同类型的 data 形状不同：
 * - tool_execution_start: { tool_name, tool_call_id, args }
 * - tool_execution_end:   { tool_name, tool_call_id, result, status, duration_ms }
 * - model_response:       { message: { content, stop_reason } }
 * 因为形状不固定，所以用 `Record<string, unknown> | null`。
 */
export interface TaskEvent {
  /** 事件序号，单调递增；轮询时用 after_seq 做增量拉取。 */
  seq: number
  /**
   * 事件时间。后端可能给 ISO 字符串，也可能给毫秒时间戳；
   * normalizeEvent 会统一转成字符串保存，页面展示时由 formatDateTime 兼容两种形态。
   * 后端没返回时就是 undefined。
   */
  ts?: string
  /** 事件类型，例如 agent_start / turn_start / tool_execution_end。 */
  type: string
  /** 事件属于第几轮；agent_start 这类事件可能没有轮次，所以是 null。 */
  turn?: number | null
  /** 事件数据；可能为 null。 */
  data?: Record<string, unknown> | null
}

/**
 * 事件分页返回。
 *
 * `events` 是这一页的事件；
 * `next_seq` 告诉前端“下次从哪个序号之后继续拉”；
 * `has_more` 表示“后端还有更多事件没返回”。
 */
export interface EventPage {
  events: TaskEvent[]
  next_seq?: number
  has_more?: boolean
}

/**
 * GET /turns/{turn}/context 的原始返回。
 * 三个字段都可能没有，所以统一标成可选。
 */
export interface TurnContextRaw {
  messages?: unknown[]
  tools?: unknown[]
  budget?: unknown
  [key: string]: unknown
}

/**
 * 页面使用的轮次上下文：messages / tools 一律是数组，
 * 渲染时不用再判断“是不是 undefined”。
 *
 * `raw` 保留原始对象，方便在“原始数据”折叠区里查看。
 */
export interface TurnContextView {
  messages: unknown[]
  tools: unknown[]
  budget: unknown
  raw: unknown
}

/**
 * 时间线轮次：由事件归并出来，不是后端直接返回的。
 *
 * 这样页面只依赖事件流，后端无需额外提供“轮次列表”接口。
 * 例如后端返回：
 *   turn_start(turn=1) -> model_response(turn=1) -> tool_execution_start(turn=1) ...
 * deriveTurns() 会把它们合成一个 TurnView。
 */
export interface ToolCallView {
  /** 工具调用 ID，用于把 start / update / end 三个事件配成一对。 */
  tool_call_id: string
  /** 工具名，例如 get_slow_sql、get_table_schema。 */
  tool_name: string
  /** 调用参数；不同工具形状不同，保持 unknown。 */
  args?: unknown
  /**
   * 页面状态。为了让组件只处理有限几种值，normalize.ts 会统一成：
   * running / ok / no_data / error / timeout / blocked / cancelled / invalid_arguments
   */
  status: string
  /** 工具返回的原始结果（可能很大，页面只展示 preview）。 */
  result?: unknown
  /** 结果预览，normalize.ts 会截断到 4000 字符左右。 */
  result_preview?: string
  /** 原始证据 ID，用于按引用读取有界预览。 */
  raw_ref?: string | null
  /** 工具执行耗时（毫秒）。 */
  duration_ms?: number | null
  /** 是否被标记为错误；某些后端只给这个字段，不给 status。 */
  is_error?: boolean
  /** 最后一次更新这条调用的事件序号，调试时有用。 */
  last_seq?: number
}

export interface TurnView {
  /** 轮次编号，从 1 开始。 */
  turn: number
  /** 页面状态：running / completed / failed / cancelled / timeout / unknown 等。 */
  status: string
  /** 本轮第一件事的时间。 */
  started_at?: string
  /** 本轮结束时间。 */
  ended_at?: string
  /** 助手（模型）在这一轮输出的正文。 */
  assistant_text: string
  /** 模型停止原因，例如 stop / length / tool_use。 */
  assistant_stop_reason?: string | null
  /** 本轮发生的所有工具调用。 */
  tool_calls: ToolCallView[]
  /** 是否已经看到 model_request 事件，用于判断请求是否真的发出。 */
  model_request_seen: boolean
  /** 是否已经看到 model_response 事件。 */
  model_response_seen: boolean
  /** 本轮累计事件数，用来在时间线上显示“有多少条记录”。 */
  event_count: number
}

/**
 * Topic 里的一条事实。
 * 事实正文 + 支撑它的证据引用。
 */
export interface TopicFact {
  text: string
  evidence_refs: string[]
}

/**
 * Topic 里的一个候选原因。
 * 例如“索引缺失”“锁等待”“统计信息过期”。
 */
export interface TopicCandidate {
  text: string
  /** 候选状态，例如 supported / rejected / open；后端字段不固定，先保留 string。 */
  status?: string
  /** 支持这个候选的证据 ID。 */
  support_refs: string[]
  /** 反驳这个候选的证据 ID。 */
  against_refs: string[]
}

/**
 * 页面使用的 Topic 结构：后端字段名不同也能归一。
 * 字段全部存在（哪怕是空数组），组件里可以直接 map。
 */
export interface TopicView {
  /** 当前要回答的问题。 */
  question: string
  /**
   * 排查范围的“一行可读文本”，例如：
   *   “工单 TCK-20261029-001 · 实例 db-mysql-001 · 库 shop_order · 时间 …”
   *
   * 注意：真实后端返回的 scope 是对象，不是字符串。
   * normalize.ts 里的 formatTopicScope() 会先把对象拼成这段文本，
   * 组件因此永远只需要处理 string，不用在 JSX 里判断两种形状。
   */
  scope: string
  facts: TopicFact[]
  candidates: TopicCandidate[]
  open_questions: string[]
  next_steps: string[]
  /**
   * 本轮已经尝试过的工具名（后端 attempted_tools）。
   * 它和“能力目录里注册了哪些工具”不是一回事：
   * 这里只记录真的调用过的工具，按调用顺序排列。
   */
  attempted_tools: string[]
  version?: number | null
  updated_at?: string | null
  /** 原始对象，方便调试。 */
  raw: unknown
}

/**
 * 报告里的一条证据引用。
 * 注意这里的 ref 一般对应 evidence_id，不是证据正文。
 */
export interface ReportEvidence {
  ref: string
  note?: string
}

/**
 * 页面使用的报告结构：后端可以返回字符串，也可以返回结构化对象。
 *
 * `markdown` 必须有，哪怕后端只给了结构化对象，
 * normalizeReport() 也会把结构化内容拼成 markdown 或留空。
 */
export interface FinalReport {
  /** 报告正文。后端 v0 以 markdown 返回，页面按 markdown 渲染。 */
  markdown: string
  /** 结构化摘要，便于页面单独展示。 */
  summary: string
  evidence: ReportEvidence[]
  recommendations: string[]
  verification: string[]
  limitations: string[]
  /** 原始返回值。 */
  raw: unknown
}

/**
 * 能力目录里的一个条目（一个 Skill 或一个工具）。
 * 注意：能力目录只说明“后端注册了什么”，不代表本轮真的调用了它。
 * 本轮实际调用了哪些工具，以事件流里的 tool_execution_* 为准。
 */
export interface CapabilityView {
  /** 后端内部名称，例如 slow_sql；页面用作稳定 key。 */
  name: string
  /**
   * 展示名，例如“慢 SQL 调查”。
   * 后端没有 label 时页面会退回 name，所以这里是可选字段。
   * 问号 `label?:` 是 TS 的可选属性写法，等价于 `string | undefined`。
   */
  label?: string
  description?: string
  raw: unknown
}

/** 能力目录：技能、工具，以及可选的模型列表。 */
export interface CapabilitiesView {
  skills: CapabilityView[]
  tools: CapabilityView[]
  /**
   * 后端新版把模型列表也塞进了 capabilities，形状和 GET /api/models 完全一样。
   *
   * 为什么允许 null？
   * - 前端优先单独请求 /api/models；
   * - 如果那个请求失败，可以退回复用 capabilities.models；
   * - 老版本后端没有这个字段时就是 null，页面不会因此崩溃。
   */
  models: ModelsView | null
}

/**
 * 证据列表里的一条。
 * size 可能是字节数，也可能是字符数，后端字段不固定，所以叫 size。
 */
export interface EvidenceItemView {
  evidence_id: string
  tool_name?: string
  tool_call_id?: string
  size?: number | null
  truncated?: boolean
  /**
   * 这条证据是不是“工具执行失败时的错误输出”。
   *
   * 真实后端用 is_error 标记。它和 truncated 是两个独立维度：
   * - is_error=true：证据内容是错误信息，恰好说明这次工具调用失败了；
   * - truncated=true：证据内容太长，后端只保存/内联了前面一段。
   * 所以页面上要分两列展示，不能合成一个“异常”布尔值。
   *
   * 为什么是可选（`?`）？早期后端没有这个字段，
   * 页面要能区分“后端明确说 false”和“后端根本没给”。
   */
  is_error?: boolean
  created_at?: string
  raw: unknown
}

/**
 * 证据有界预览的一段内容。
 *
 * 后端支持 offset/limit，前端一次只读 4000 字符，
 * 不会把几百 MB 的日志一次性塞进浏览器。
 */
export interface EvidenceChunk {
  evidence_id: string
  content: string
  /** 这一段从第几个字符开始。 */
  offset: number
  /** 这一段最多包含多少字符。 */
  limit: number
  /** 证据总长度（如果后端知道）。 */
  total_chars?: number | null
  /** 是否还有未展示的内容。 */
  truncated?: boolean
  raw: unknown
}

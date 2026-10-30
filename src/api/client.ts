/**
 * ============================================================================
 * 后端 HTTP 客户端
 * ============================================================================
 *
 * 这个文件负责三件事：
 * 1. 拼请求地址、发 fetch 请求；
 * 2. 把网络错误、HTTP 错误统一成 ApiError，页面只需要展示一条消息；
 * 3. 调用 normalize.ts，把后端原始 JSON 转成页面模型。
 *
 * 联调策略：
 * - 开发环境默认用相对路径 `/api`，由 vite.config.ts 的 proxy 转发到 127.0.0.1:8000。
 *   这样浏览器不会遇到跨域问题，也不需要在前端写死后端地址。
 * - 如果需要直连后端，设置环境变量 VITE_API_BASE_URL（见 .env.example）。
 *
 * 错误处理约定：
 * - 网络层失败和 HTTP 非 2xx 都统一抛 ApiError，页面只处理一种错误类型；
 * - 404 在业务上通常表示“还没生成 / 不存在”，调用方需要单独判断；
 * - 所有成功的 JSON 仍然交给 normalize.ts 兼容字段，client 不做业务字段假设。
 */

import {
  asArray,
  asRecord,
  normalizeCapabilities,
  normalizeCreateTask,
  normalizeEventPage,
  normalizeEvidenceChunk,
  normalizeEvidenceList,
  normalizeModels,
  normalizeReport,
  normalizeSamples,
  normalizeTask,
} from './normalize'
import type {
  CapabilitiesView,
  CreateTaskInput,
  CreateTaskResponse,
  EventPage,
  EvidenceChunk,
  EvidenceItemView,
  FinalReport,
  ModelsView,
  SampleView,
  TaskDetail,
  TurnContextView,
} from './types'

/**
 * `import.meta.env` 是 Vite 提供的环境变量对象。
 * `VITE_` 开头的变量才会被注入到前端代码里。
 *
 * `?? ''` 的意思是：如果变量是 undefined 或 null，就用空字符串。
 * 空字符串代表“走 Vite 代理”，所以下面用 `BASE_URL || '通过 Vite 代理 /api'` 做展示。
 *
 * `.replace(/\/+$/, '')` 去掉末尾多余的斜杠：
 *   'http://127.0.0.1:8000/' -> 'http://127.0.0.1:8000'
 * 这样后面拼 `/api/...` 不会出现双斜杠。
 */
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')
const EVENT_PAGE_LIMIT = 200

/**
 * 证据预览一次最多读多少字符。
 *
 * 为什么要有上限？
 * 线上慢 SQL 的 explain / 日志可能几十 MB，如果一次性返回给浏览器，
 * 页面会卡死、内存会爆。所以后端提供 offset/limit，前端一次只取 4000 字符。
 *
 * 4000 字符大概相当于 2~3 屏中文或 100 行左右日志，足够判断内容，
 * 又不会把页面拖慢。
 */
export const EVIDENCE_PAGE_LIMIT = 4000

/** 页面状态栏可以显示当前请求地址；空字符串表示走 Vite 代理。 */
export const apiBaseLabel = BASE_URL || '通过 Vite 代理 /api'

/**
 * 统一的接口错误。
 *
 * `class ApiError extends Error` 表示它继承 JavaScript 自带的 Error：
 * - 可以用 `throw new ApiError(...)` 抛出；
 * - 可以用 `error instanceof ApiError` 判断；
 * - 也保留了 Error 的 message / stack 等能力。
 *
 * `readonly` 表示属性只能在构造函数里赋值，之后不能改。
 * 例如 `error.status = 500` 会直接编译报错，避免错误对象被意外修改。
 */
export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/**
 * 类型守卫（Type Guard）。
 *
 * 返回值写成 `error is ApiError`，而不是普通的 `boolean`。
 * 这样调用方写：
 *
 *   if (isApiError(err)) {
 *     console.log(err.status) // 编译器知道 err 是 ApiError，允许访问 status
 *   }
 *
 * 如果返回值只写 `boolean`，即使 if 成立，编译器仍然不知道 err 的类型，
 * 访问 `err.status` 就会报错。
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/** 404 在业务里通常表示“还没生成 / 不存在”，页面会单独显示，不当成断线。 */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

/**
 * 创建任务前做一次清洗：
 * - 去掉字符串首尾空格；
 * - 空字符串不传给后端；
 * - 不改变其他字段。
 *
 * 为什么要清洗？
 * 用户可能只输入了空格。如果直接传给后端，后端会认为“传了 ticket_text”，
 * 但内容是空的，容易产生歧义。这里提前过滤掉。
 */
function compactInput(input: CreateTaskInput): CreateTaskInput {
  const result: CreateTaskInput = {}
  if (input.sample_id?.trim()) result.sample_id = input.sample_id.trim()
  if (input.ticket_text?.trim()) result.ticket_text = input.ticket_text.trim()
  if (input.tenant_id?.trim()) result.tenant_id = input.tenant_id.trim()
  /*
    模型字段也做同样的清洗。
    这里不强行要求两个字段必须同时存在：
    - 两个都不传：后端用默认模型；
    - 只传了一个：交给后端返回 422 中文提示，比前端猜测规则更可靠。
    表单本身会保证成对提交，这里的清洗只是防御性处理。
  */
  if (input.model_provider?.trim()) result.model_provider = input.model_provider.trim()
  if (input.model_name?.trim()) result.model_name = input.model_name.trim()
  return result
}

/**
 * 读取错误响应体。
 *
 * 后端错误可能是 JSON：{ "detail": "任务不存在" }
 * 也可能是纯文本：Internal Server Error
 * 还可能是空响应。这里都兼容。
 *
 * 返回类型是 `Promise<unknown>`：调用方拿到后必须再判断类型，
 * 不能直接 `.detail`。
 */
async function readErrorBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/**
 * 从错误响应体里尽量提取一条人类可读的消息。
 *
 * FastAPI 的参数校验错误通常长这样：
 *   { "detail": [{ "loc": ["body", "sample_id"], "msg": "field required" }] }
 * 这里会把数组里的 msg 拼起来，避免页面只显示 “[object Object]”。
 */
function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim()) return body.trim()

  const record = asRecord(body)
  if (record) {
    const detail = record.detail ?? record.message ?? record.error

    if (typeof detail === 'string' && detail.trim()) return detail.trim()

    if (Array.isArray(detail)) {
      const parts = detail
        .map((item) => {
          const entry = asRecord(item)
          return entry ? String(entry.msg ?? entry.message ?? '') : ''
        })
        .filter(Boolean)
      if (parts.length > 0) return parts.join('；')
    }
  }

  return fallback
}

/**
 * 泛型请求函数。
 *
 * `async function request<T>(...) : Promise<T>` 里的 `<T>` 是“类型参数”。
 * 调用时这样写：
 *
 *   const detail = await request<TaskDetail>('/api/tasks/xxx')
 *   // detail 的类型就是 TaskDetail
 *
 * 如果不写 `<TaskDetail>`，TypeScript 会尽量推断；但接口返回是运行时 JSON，
 * 编译器无法真的知道里面是什么，所以调用方显式指定更清晰。
 *
 * 注意：`as T` 只是类型断言，不会校验数据。
 * 真正的字段兼容处理在 normalize.ts 里做。
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)

  // 有 body 且调用方没手动设置 Content-Type 时，默认按 JSON 发送。
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...init, headers })
  } catch (error) {
    // 网络层失败（后端没启动、DNS 解析失败、连接被拒绝）统一成 ApiError。
    // status = 0 表示“根本没拿到 HTTP 响应”，页面可以据此提示“后端未连接”。
    const message = error instanceof Error ? error.message : String(error)
    throw new ApiError(`无法连接后端：${message}`, 0, null)
  }

  if (!response.ok) {
    const body = await readErrorBody(response)
    throw new ApiError(
      errorMessage(body, `后端返回 HTTP ${response.status}`),
      response.status,
      body,
    )
  }

  // 204 / 205 表示“成功但没有响应体”。例如取消任务可能返回 204。
  // 这里返回 undefined，调用方需要自己判断。
  if (response.status === 204 || response.status === 205) {
    return undefined as T
  }

  const text = await response.text()
  if (!text) return undefined as T

  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError('后端返回的内容不是 JSON', response.status, text)
  }
}

/**
 * 页面用到的所有后端接口都集中在这个对象里。
 *
 * 这样做的好处：
 * - 组件里不会散落 fetch 调用；
 * - 以后加鉴权、加请求头、换 baseURL，只改这里；
 * - 每个方法的入参和返回值类型都一目了然。
 */
export const api = {
  /** 拉取样例工单列表。前端不硬编码样例，后端返回什么就展示什么。 */
  async listSamples(signal?: AbortSignal): Promise<SampleView[]> {
    const raw = await request<unknown>('/api/samples', { signal })
    return normalizeSamples(raw)
  },

  /**
   * 创建任务。
   *
   * `AbortSignal` 用于取消请求：组件卸载或用户离开页面时，可以中止还没完成的 fetch。
   * 这里把它透传给 fetch，浏览器会抛出 AbortError。
   */
  async createTask(input: CreateTaskInput, signal?: AbortSignal): Promise<CreateTaskResponse> {
    const raw = await request<unknown>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(compactInput(input)),
      signal,
    })
    return normalizeCreateTask(raw)
  },

  /** 读取任务详情：状态、当前轮次、Topic、报告、错误。 */
  async getTask(taskId: string, signal?: AbortSignal): Promise<TaskDetail> {
    // encodeURIComponent 防止 taskId 里出现 /、? 等字符把 URL 结构弄乱。
    const raw = await request<unknown>(`/api/tasks/${encodeURIComponent(taskId)}`, { signal })
    return normalizeTask(raw)
  },

  /**
   * 增量读取事件。
   *
   * after_seq 表示“只要序号大于这个值的事件”。
   * 例如已经拿到 seq 1~10，下次就传 after_seq=10，只取 11 之后的事件。
   */
  async getEvents(taskId: string, afterSeq: number, signal?: AbortSignal): Promise<EventPage> {
    const query = new URLSearchParams({
      after_seq: String(afterSeq),
      limit: String(EVENT_PAGE_LIMIT),
    })
    const raw = await request<unknown>(
      `/api/tasks/${encodeURIComponent(taskId)}/events?${query.toString()}`,
      { signal },
    )
    return normalizeEventPage(raw, afterSeq)
  },

  /**
   * 读取某一轮的上下文。
   *
   * 这个接口只在用户点开“本轮上下文”时才调用，
   * 避免一次把所有轮次的完整上下文都加载进浏览器。
   */
  async getTurnContext(
    taskId: string,
    turn: number,
    signal?: AbortSignal,
  ): Promise<TurnContextView> {
    const raw = await request<unknown>(
      `/api/tasks/${encodeURIComponent(taskId)}/turns/${encodeURIComponent(String(turn))}/context`,
      { signal },
    )
    const record = asRecord(raw) ?? {}
    return {
      messages: asArray(record.messages),
      tools: asArray(record.tools),
      budget: record.budget,
      raw,
    }
  },

  /**
   * 读取最终报告。
   *
   * 后端可能返回：
   * - 纯字符串（markdown）；
   * - { markdown, structured }；
   * - 结构化对象；
   * - 404（报告还没生成）。
   * normalizeReport 会把前三种统一成 FinalReport | null；404 由调用方处理。
   */
  async getReport(taskId: string, signal?: AbortSignal): Promise<FinalReport | null> {
    const raw = await request<unknown>(`/api/tasks/${encodeURIComponent(taskId)}/report`, { signal })
    return normalizeReport(raw)
  },

  /**
   * 取消任务。
   *
   * 后端已确认：正常取消返回 202 + 任务详情快照；任务已经是终态时
   * 按幂等返回 200 任务详情；未知任务返回 404。
   * 另外也兼容 204/200 + { ok: true } 这类没有任务详情的实现。
   *
   * 返回类型是 `TaskDetail | null`：
   * - 返回体像任务详情 -> TaskDetail；
   * - 返回体为空或不像任务 -> null。
   * 返回 null 时页面继续轮询即可，不能把空对象当成任务状态。
   */
  async cancelTask(taskId: string, signal?: AbortSignal): Promise<TaskDetail | null> {
    const raw = await request<unknown>(
      `/api/tasks/${encodeURIComponent(taskId)}/cancel`,
      { method: 'POST', signal },
    )
    if (raw === undefined || raw === null) return null

    const record = asRecord(raw)
    if (!record) return null

    // 判断返回体像不像任务详情：顶层或 task 字段里至少要有 task_id / status。
    const outerTask = asRecord(record.task)
    const hasTaskShape =
      ['task_id', 'id', 'status', 'state'].some((key) => key in record) ||
      (outerTask !== null && ['task_id', 'id', 'status', 'state'].some((key) => key in outerTask))
    if (!hasTaskShape) return null

    return normalizeTask(raw)
  },

  /** 读取证据列表。 */
  async listEvidence(taskId: string, signal?: AbortSignal): Promise<EvidenceItemView[]> {
    const raw = await request<unknown>(
      `/api/tasks/${encodeURIComponent(taskId)}/evidence`,
      { signal },
    )
    return normalizeEvidenceList(raw)
  },

  /**
   * 读取证据的一段有界预览。
   *
   * limit 由调用方传入，页面统一用 EVIDENCE_PAGE_LIMIT（4000）。
   * 后端如果支持更大的值，前端也不应该一次取太多。
   */
  async getEvidence(
    taskId: string,
    evidenceId: string,
    offset: number,
    limit: number,
    signal?: AbortSignal,
  ): Promise<EvidenceChunk> {
    const query = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
    })
    const raw = await request<unknown>(
      `/api/tasks/${encodeURIComponent(taskId)}/evidence/${encodeURIComponent(evidenceId)}?${query.toString()}`,
      { signal },
    )
    return normalizeEvidenceChunk(raw, evidenceId, offset, limit)
  },

  /**
   * 读取可用模型列表。
   *
   * 返回值回答三个问题：
   * - 服务端默认用哪个 provider；
   * - 每个 provider 支持哪些模型；
   * - 哪些 provider 当前不可用，以及不可用原因。
   *
   * 页面用它渲染“模型来源 / 模型”两个下拉框。
   * 注意这只是“可选项”，不代表当前任务实际用了哪个模型；
   * 任务实际使用的模型以任务快照里的 model_provider / model_name 为准。
   */
  async getModels(signal?: AbortSignal): Promise<ModelsView> {
    const raw = await request<unknown>('/api/models', { signal })
    return normalizeModels(raw)
  },

  /**
   * 读取能力目录。
   *
   * 这里返回的是“后端注册了哪些 Skill / 工具”，
   * 不代表本轮实际调用了它们。实际调用看事件流里的 tool_execution_*。
   */
  async getCapabilities(signal?: AbortSignal): Promise<CapabilitiesView> {
    const raw = await request<unknown>('/api/capabilities', { signal })
    return normalizeCapabilities(raw)
  },
}

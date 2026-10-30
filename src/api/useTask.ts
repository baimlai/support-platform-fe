/**
 * ============================================================================
 * 任务轮询 Hook（useTask）
 * ============================================================================
 *
 * 这个文件把“创建任务之后怎么持续获取最新状态”封装成一个 React Hook。
 * 页面组件只需要：
 *
 *   const { task, events, turns, topic, report, cancel, refresh } = useTask(taskId)
 *
 * 为什么先轮询而不是 SSE：
 * - 后端 v0 已经提供按 after_seq 分页的事件接口，轮询能完整恢复刷新后的时间线；
 * - SSE 后端说后续可提供，前端只需要改这个 Hook，页面组件不感知传输方式。
 *
 * 行为约定：
 * - 每 1.5 秒拉一次任务详情和增量事件，任务终态后停止；
 * - 网络失败时 3 秒后重试，页面显示错误，但不伪造“任务在跑”；
 * - 页面刷新会从 seq=0 重新拉事件，依赖后端持久化事件恢复；
 * - 任务终态后拉一次报告；404 表示报告还没生成，显示空状态即可。
 *
 * 实现约定：
 * - Hook 必须写在函数组件或其他 Hook 的顶层，不能放在 if / for 里；
 * - 轮询定时器、请求和清理函数放在同一个 useEffect 中，taskId 或 refreshKey 变化时整体重启；
 * - 用 ref 保存上一次的 seq 和任务 ID，避免 state 更新触发不必要的 effect 重启。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, isApiError, isNotFoundError } from './client'
import { deriveTurns, isTerminalStatus, mergeEventLists, normalizeReport, normalizeTopic } from './normalize'
import type { FinalReport, TaskDetail, TaskEvent, TopicView, TurnView } from './types'

/** 正常运行时的轮询间隔：1.5 秒。 */
const POLL_INTERVAL_MS = 1500

/** 网络出错后的重试间隔：3 秒，避免后端没启动时疯狂请求。 */
const RETRY_INTERVAL_MS = 3000

/**
 * Hook 的返回值类型。
 *
 * `ReturnType<typeof deriveTurns>` 表示直接取 deriveTurns 的返回值类型。
 * 这样以后 deriveTurns 返回值变了，这里不用手动同步，等价于写 `TurnView[]`。
 */
export interface UseTaskResult {
  task: TaskDetail | null
  events: TaskEvent[]
  turns: TurnView[]
  topic: TopicView | null
  report: FinalReport | null
  loading: boolean
  polling: boolean
  error: string | null
  cancelling: boolean
  cancel: () => Promise<void>
  refresh: () => void
}

/** 把 unknown 异常转成可展示的字符串。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * `taskId` 为 null 时表示“当前没有任务”。
 * Hook 会清空所有状态，不发送任何请求。
 */
export function useTask(taskId: string | null): UseTaskResult {
  /**
   * useState 的泛型写法：
   *   useState<TaskDetail | null>(null)
   * 表示这个 state 的值要么是 TaskDetail，要么是 null。
   * 初始值是 null，所以类型里必须包含 null，否则会编译报错。
   */
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [events, setEvents] = useState<TaskEvent[]>([])
  const [report, setReport] = useState<FinalReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  /**
   * 轮询是否已经因为“任务不存在（404）”而停掉。
   *
   * 为什么需要单独一个 state？
   * - 404 之后 task 还是 null，`isTerminalStatus(null)` 返回 false，
   *   如果只看任务状态，页面会一直显示“轮询中”，误导用户以为还在等数据；
   * - 这个标记只由 404 设置，其他错误仍会 3 秒重试，不能算“停止”。
   */
  const [halted, setHalted] = useState(false)

  /**
   * refreshKey 是一个“计数器”：
   * 每次点刷新就 +1，useEffect 的依赖数组里包含它，于是 effect 会重新执行。
   * 这是 React 里“手动触发重新请求”的常见写法。
   */
  const [refreshKey, setRefreshKey] = useState(0)

  /**
   * useRef 返回一个对象，结构是 { current: 值 }。
   * 修改 ref.current 不会触发重新渲染，适合保存“上一次的 ID / seq”这类内部状态。
   */
  const lastTaskIdRef = useRef<string | null>(null)
  const lastSeqRef = useRef(0)
  const reportFetchedRef = useRef(false)

  useEffect(() => {
    // taskId 为空：清空所有状态，直接返回。
    // 注意 effect 要么不返回值（undefined），要么返回一个清理函数。
    if (!taskId) {
      lastTaskIdRef.current = null
      lastSeqRef.current = 0
      reportFetchedRef.current = false
      setTask(null)
      setEvents([])
      setReport(null)
      setError(null)
      setLoading(false)
      setCancelling(false)
      setHalted(false)
      return
    }

    // 每次 effect 重新开始（新任务或点刷新）都先解除“已停止”标记。
    setHalted(false)

    // disposed 是“组件已卸载 / effect 已失效”的标记。
    // 异步请求回来时如果 disposed 为 true，就不要 setState，避免 React 警告。
    let disposed = false
    let timer: number | undefined
    let afterSeq = lastSeqRef.current

    // AbortController 用于中止 fetch。组件卸载时调用 controller.abort()。
    const controller = new AbortController()

    // 只有 taskId 变化才清空旧任务；同一个任务点“刷新”时保留已有时间线，只重新拉增量。
    if (lastTaskIdRef.current !== taskId) {
      lastTaskIdRef.current = taskId
      afterSeq = 0
      lastSeqRef.current = 0
      reportFetchedRef.current = false
      setTask(null)
      setEvents([])
      setReport(null)
      setError(null)
      setCancelling(false)
    }

    setLoading(true)
    setError(null)

    /**
     * 安排下一次轮询。
     *
     * 用 window.setTimeout 而不是 setInterval：
     * 如果请求很慢，setInterval 会越积越多；setTimeout 是“这次请求完成后再排下一次”。
     *
     * 返回类型 `number` 是浏览器环境的定时器 ID（Node 环境里通常是对象）。
     */
    const schedule = (delayMs: number) => {
      if (!disposed) {
        timer = window.setTimeout(() => {
          void tick()
        }, delayMs)
      }
    }

    /**
     * 任务进入终态后读取报告。
     *
     * 为什么要单独一个函数？
     * - 报告可能比较大，没必要每 1.5 秒都拉；
     * - 任务详情里如果已经带了 report，就直接用，少一次请求；
     * - 404 表示“报告还没生成”，不是断线，不能显示成错误。
     */
    const fetchReportIfNeeded = async (detail: TaskDetail) => {
      if (reportFetchedRef.current) return

      const fromTask = normalizeReport(detail.report)
      if (fromTask) {
        reportFetchedRef.current = true
        setReport(fromTask)
        return
      }

      try {
        const fetched = await api.getReport(taskId, controller.signal)
        if (disposed) return
        reportFetchedRef.current = true
        setReport(fetched)
      } catch (err) {
        if (disposed) return
        reportFetchedRef.current = true
        if (!isNotFoundError(err)) setError(errorText(err))
      }
    }

    /**
     * 一次轮询：
     * 1. 同时请求任务详情和增量事件；
     * 2. 合并事件、更新 seq；
     * 3. 如果还有更多事件，立刻继续拉；
     * 4. 如果任务终态，拉报告并停止；
     * 5. 否则 1.5 秒后再来一次。
     */
    const tick = async () => {
      try {
        const [detail, page] = await Promise.all([
          api.getTask(taskId, controller.signal),
          api.getEvents(taskId, afterSeq, controller.signal),
        ])
        if (disposed) return

        setTask(detail)
        setLoading(false)
        setError(null)

        if (page.events.length > 0) {
          // 下一页从“后端给的 next_seq”和“最后一条事件的 seq”里取较大值。
          // 为什么要取较大值？防止后端漏填 next_seq，导致重复拉同一批事件。
          afterSeq = Math.max(page.next_seq ?? 0, page.events[page.events.length - 1].seq)
          lastSeqRef.current = afterSeq

          // 函数式更新：previous 是 React 传进来的“上一次的值”。
          // 这样即使连续多次 setEvents，也不会互相覆盖。
          setEvents((previous) => mergeEventLists(previous, page.events))
        } else if (page.next_seq !== undefined && page.next_seq > afterSeq) {
          // 后端可能只返回 next_seq，没有事件（例如事件刚好被清理）。
          afterSeq = page.next_seq
          lastSeqRef.current = afterSeq
        }

        /**
         * 一次拿不下就立刻继续拿，直到追上后端；否则等下一个轮询周期。
         *
         * 后端已确认：has_more 只表示“服务端此刻还有更多可读事件”，
         * has_more=false 不代表任务以后不会再产生事件。
         * 所以这里只在 has_more=true 时立刻追页；
         * 是否继续轮询由下面的任务状态决定，不能因为 has_more=false 就停。
         */
        if (page.has_more && page.events.length > 0) {
          schedule(0)
          return
        }

        if (isTerminalStatus(detail.status)) {
          await fetchReportIfNeeded(detail)
          return
        }

        schedule(POLL_INTERVAL_MS)
      } catch (err) {
        if (disposed || controller.signal.aborted) return

        setLoading(false)
        setError(errorText(err))

        // 任务不存在（404）继续轮询没有意义，直接停。
        // 同时打上 halted 标记，让“轮询中”指示器也停下来。
        // 其他错误（后端没启动、网络抖动）继续低频重试。
        if (isApiError(err) && err.status === 404) {
          setHalted(true)
          return
        }

        schedule(RETRY_INTERVAL_MS)
      }
    }

    void tick()

    // 清理函数：组件卸载、taskId 变化、refreshKey 变化时执行。
    return () => {
      disposed = true
      controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [taskId, refreshKey])

  /**
   * 取消任务。
   *
   * useCallback 缓存函数，依赖 [taskId, cancelling] 变化时才重新创建。
   * 如果每次渲染都创建新函数，传给子组件可能导致子组件不必要地重新渲染。
   *
   * 后端已确认：取消是协作式的，`POST /cancel` 返回 202 + 任务详情快照，
   * 但快照里的 status 可能仍是 running；页面继续轮询，直到后端变成 cancelled。
   * 取消接口也可能返回 204 空 body，这时不要 setTask(null)，
   * 否则页面会误以为任务丢了；继续轮询等后端状态即可。
   */
  const cancel = useCallback(async () => {
    if (!taskId || cancelling) return

    setCancelling(true)
    try {
      const detail = await api.cancelTask(taskId)
      if (detail) setTask(detail)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setCancelling(false)
    }
  }, [taskId, cancelling])

  /**
   * 手动刷新：refreshKey + 1，触发上面的 effect 重新执行。
   * 同时允许重新尝试报告接口（例如后端刚生成完）。
   */
  const refresh = useCallback(() => {
    reportFetchedRef.current = false
    setRefreshKey((key) => key + 1)
  }, [])

  /**
   * useMemo 缓存派生数据：
   * 只有 events 变化时才重新计算轮次，其他状态变化（例如 loading）不会白白计算。
   */
  const turns = useMemo(() => deriveTurns(events), [events])

  /**
   * Topic 的读取优先级：
   * 1. 最近一次 topic_updated 事件里的 topic；
   * 2. 任务详情里的 topic；
   * 3. 都没有就是 null，页面显示空状态。
   */
  const topic = useMemo(() => {
    const lastTopicEvent = [...events].reverse().find((event) => event.type === 'topic_updated')
    if (lastTopicEvent) {
      const data = lastTopicEvent.data ?? {}
      const fromEvent = normalizeTopic(data.topic ?? data)
      if (fromEvent) return fromEvent
    }
    return normalizeTopic(task?.topic)
  }, [events, task])

  /**
   * 报告优先用单独接口拿到的；没有就退回任务详情里带的。
   * 两者都没有就是 null。
   */
  const effectiveReport = useMemo(
    () => report ?? normalizeReport(task?.report),
    [report, task],
  )

  /**
   * 是否还在轮询。
   *
   * Boolean(taskId) 把字符串转成 true，null 转成 false。
   * 条件：
   * - 有任务 ID；
   * - 没有因为 404 停止；
   * - 任务状态不是终态；
   * - 事件流里没有 agent_end。
   */
  const polling =
    Boolean(taskId) &&
    !halted &&
    !isTerminalStatus(task?.status) &&
    !events.some((event) => event.type === 'agent_end')

  return {
    task,
    events,
    turns,
    topic,
    report: effectiveReport,
    loading,
    polling,
    error,
    cancelling,
    cancel,
    refresh,
  }
}

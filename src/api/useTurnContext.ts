/**
 * ============================================================================
 * 单轮上下文 Hook（useTurnContext）
 * ============================================================================
 *
 * 这个 Hook 只在用户选中某一轮、并把“本轮上下文”展开时才请求后端。
 * 为什么按需加载？
 * 每一轮的上下文可能包含很长的消息历史、工具定义和预算信息。
 * 如果页面一打开就把所有轮次都读进来，浏览器内存和带宽都会浪费。
 *
 * 用法：
 *
 *   const { context, loading, error, notFound } = useTurnContext(taskId, turn)
 *
 * 注意：如果暂时不想加载，可以传 null：
 *
 *   useTurnContext(contextOpen ? taskId : null, contextOpen ? turn : null)
 *
 * Hook 内部会清空状态，不会发请求。
 *
 * 请求约定：
 * - 依赖变化时先清空上一次结果，再发新请求；
 * - 旧请求通过 AbortController 中止，避免旧响应覆盖新轮次的数据；
 * - 404 单独标记为 notFound，和网络错误分开显示。
 */

import { useEffect, useState } from 'react'
import { api, isNotFoundError } from './client'
import type { TurnContextView } from './types'

/**
 * Hook 返回值。
 *
 * 这里用 interface 描述对象形状：
 * - `context` 可能为 null（还没加载 / 加载失败 / 后端没返回）；
 * - `loading` 表示请求进行中；
 * - `error` 是真正的错误消息；
 * - `notFound` 单独标记 404，因为“该轮上下文还没落库”和“后端挂了”不是一回事。
 */
export interface UseTurnContextResult {
  context: TurnContextView | null
  loading: boolean
  error: string | null
  notFound: boolean
}

export function useTurnContext(
  taskId: string | null,
  turn: number | null,
): UseTurnContextResult {
  /**
   * useState 的类型由初始值推断：
   * - `useState<TurnContextView | null>(null)` 显式写出泛型；
   * - `useState(false)` 会自动推断为 boolean。
   */
  const [context, setContext] = useState<TurnContextView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    // 没有任务 ID 或没有轮次：清空状态，不发请求。
    if (!taskId || turn === null) {
      setContext(null)
      setLoading(false)
      setError(null)
      setNotFound(false)
      return
    }

    // 每次 effect 执行都创建一个新的 AbortController。
    // 依赖变化时，上一个 effect 的清理函数会 abort 掉旧请求。
    const controller = new AbortController()

    setContext(null)
    setLoading(true)
    setError(null)
    setNotFound(false)

    api
      .getTurnContext(taskId, turn, controller.signal)
      .then((result) => {
        // 请求回来时如果已经被取消，就不要再更新状态。
        if (controller.signal.aborted) return
        setContext(result)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setLoading(false)

        if (isNotFoundError(err)) {
          // 404：后端还没有这一轮的上下文，或者该轮还没开始。
          setNotFound(true)
          return
        }

        setError(err instanceof Error ? err.message : String(err))
      })

    // 清理函数：依赖变化或组件卸载时中止请求。
    return () => controller.abort()
  }, [taskId, turn])

  return { context, loading, error, notFound }
}

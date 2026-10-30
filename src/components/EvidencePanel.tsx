/**
 * ============================================================================
 * 证据列表
 * ============================================================================
 *
 * 任务运行过程中，工具返回的大结果会由后端保存成证据文件。
 * 这个面板只展示证据的元信息，不加载正文：
 * - evidence_id：证据 ID，后续按 ID 读取；
 * - tool_name / tool_call_id：哪次工具调用产生的；
 * - size / truncated：大小或长度、是否被截断；
 * - created_at：写入时间。
 *
 * 正文只在用户点击“预览”时，由 EvidenceDrawer 按 offset/limit 读取。
 * 这样即使证据有几十 MB，页面也不会一次全部加载。
 */

import { useEffect, useState } from 'react'
import { api, isNotFoundError } from '../api/client'
import type { EvidenceItemView } from '../api/types'
import { formatDateTime, formatNumber } from '../utils/format'
import { EmptyState, Notice } from './EmptyState'
import { StatusBadge } from './StatusBadge'
import { FileIcon, RefreshIcon } from './icons'

/**
 * 证据面板的参数。
 *
 * `onOpenEvidence` 是父组件的回调，点击“预览”时把证据 ID 交出去，
 * 由父组件决定打开哪个抽屉。子组件不自己管理抽屉，职责更单一。
 */
interface EvidencePanelProps {
  taskId: string
  onOpenEvidence: (evidenceId: string) => void
}

export function EvidencePanel({ taskId, onOpenEvidence }: EvidencePanelProps) {
  /**
   * useState 泛型：
   * - `useState<EvidenceItemView[]>([])`：数组里每个元素都是 EvidenceItemView；
   * - `useState<string | null>(null)`：错误消息要么是字符串，要么是 null；
   * - `useState(0)`：数字，TypeScript 自动推断为 number。
   */
  const [items, setItems] = useState<EvidenceItemView[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  /**
   * useEffect 的三个关键点：
   * 1. 依赖数组 [taskId, reloadKey] 变化时才重新执行；
   * 2. 请求带 AbortController.signal，组件卸载时中止；
   * 3. 清理函数里把 disposed 置 true，防止请求回来后再 setState。
   *
   * 为什么 disposed 和 abort 两个都要？
   * abort 让 fetch 尽快失败；disposed 是给“已经拿到响应、但组件已卸载”
   * 这种极短时间差兜底，避免 React 警告和状态错乱。
   */
  useEffect(() => {
    const controller = new AbortController()
    let disposed = false

    setLoading(true)
    setError(null)

    api
      .listEvidence(taskId, controller.signal)
      .then((list) => {
        if (disposed) return
        setItems(list)
        setLoading(false)
      })
      .catch((err: unknown) => {
        /*
          catch 参数写成 `unknown` 是 TypeScript 的推荐做法。
          JavaScript 可以 throw 任何值（字符串、对象、数字），
          写成 unknown 会强制我们先判断类型，不能直接 err.message。
        */
        if (disposed || controller.signal.aborted) return
        setLoading(false)

        // 404 表示任务还没有证据（可能还没开始，或后端没有写证据）。
        // 这种情况显示空列表，不显示成错误。
        if (isNotFoundError(err)) {
          setItems([])
          return
        }

        // `err instanceof Error` 是类型守卫：成立时 err 才是 Error，
        // 才能安全地读 message；否则用 String(err) 兜底。
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      disposed = true
      controller.abort()
    }
  }, [taskId, reloadKey])

  return (
    <section className="panel evidence-panel">
      <div className="panel__header">
        <div>
          <div className="panel__eyebrow">后端保存</div>
          <h2 className="panel__title">证据</h2>
        </div>
        {/*
          刷新按钮不直接调用请求函数，而是把 reloadKey +1。
          reloadKey 是 useEffect 的依赖，值一变 effect 就重新跑，
          相当于“用 state 触发一次重新加载”。

          `setReloadKey((key) => key + 1)` 用函数式更新：
          React 会把上一次的值作为 key 传进来，连续点击也不会丢更新。
        */}
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => setReloadKey((key) => key + 1)}
          disabled={loading}
        >
          <RefreshIcon size={14} />
          {loading ? '加载中' : '刷新'}
        </button>
      </div>

      {error ? <Notice tone="error">证据列表加载失败：{error}</Notice> : null}

      {items.length === 0 ? (
        <EmptyState
          title={loading ? '正在读取证据列表…' : '后端尚未返回证据'}
          description={
            loading
              ? '正在请求 /api/tasks/{task_id}/evidence。'
              : '任务运行中或工具还没有产生大结果时，证据列表可能为空。'
          }
          icon={<FileIcon size={22} />}
        />
      ) : (
        <>
          <div className="evidence-table-wrap">
            <table className="evidence-table">
              <thead>
                <tr>
                  <th>证据 ID</th>
                  <th>来源工具</th>
                  <th>状态</th>
                  <th>大小/长度</th>
                  <th>截断</th>
                  <th>写入时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.evidence_id}>
                    <td>
                      {/* title 让完整 ID 在悬停时可见，表格列宽不会被撑开。 */}
                      <code className="evidence-table__id" title={item.evidence_id}>
                        {item.evidence_id}
                      </code>
                    </td>
                    {/* tool_name 可能是 null，`??` 会退回破折号。 */}
                    <td>{item.tool_name ?? '—'}</td>
                    {/*
                      证据状态来自 is_error：
                      - undefined：后端没给这个字段 -> 显示破折号，不猜“正常”；
                      - true：这次工具调用失败，证据内容其实是错误信息；
                      - false：工具成功返回，证据内容才是真正的工具结果。
                      StatusBadge 传 kind="tool" 是为了复用“失败/成功”这套工具文案。
                    */}
                    <td>
                      {item.is_error === undefined ? (
                        '—'
                      ) : (
                        <StatusBadge status={item.is_error ? 'error' : 'ok'} kind="tool" />
                      )}
                    </td>
                    <td>{formatNumber(item.size)}</td>
                    {/*
                      嵌套三元表达式按顺序读：
                      1. truncated 是 undefined -> '—'（后端没给这个字段）；
                      2. truncated 是 true       -> '是'；
                      3. 否则                    -> '否'。
                      注意不能直接写 item.truncated ? '是' : '否'，
                      否则“未知”会被误显示成“否”。
                    */}
                    <td>{item.truncated === undefined ? '—' : item.truncated ? '是' : '否'}</td>
                    {/* created_at 为空时不调用格式化函数，直接显示破折号。 */}
                    <td>{item.created_at ? formatDateTime(item.created_at) : '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => onOpenEvidence(item.evidence_id)}
                      >
                        预览
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="evidence-panel__hint">
            预览按 offset/limit 分段读取，每次最多 4000 字符；正文较大时不会一次性载入页面。
          </p>
        </>
      )}
    </section>
  )
}

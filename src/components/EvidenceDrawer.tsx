/**
 * ============================================================================
 * 证据预览抽屉
 * ============================================================================
 *
 * 证据正文可能非常大，所以这里按 offset/limit 分段读取：
 * - 每次最多 EVIDENCE_PAGE_LIMIT（4000）个字符；
 * - 顶部显示当前查看的字符区间和总长度；
 * - 如果后端标记还有内容，可以继续加载下一页。
 *
 * 页面不会把整个证据文件塞进 DOM。即使后端返回 10 MB，浏览器也只持有当前这一段。
 *
 * 交互：
 * - 点击遮罩或按 Esc 关闭；
 * - 打开时锁定 body 滚动，关闭后恢复；
 * - 打开时把焦点移到关闭按钮，方便键盘用户。
 */

import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { api, EVIDENCE_PAGE_LIMIT, isNotFoundError } from '../api/client'
import type { EvidenceChunk } from '../api/types'
import { formatNumber } from '../utils/format'
import { Notice } from './EmptyState'
import { CloseIcon, FileIcon } from './icons'

interface EvidenceDrawerProps {
  taskId: string
  evidenceId: string
  onClose: () => void
}

export function EvidenceDrawer({ taskId, evidenceId, onClose }: EvidenceDrawerProps) {
  const [offset, setOffset] = useState(0)
  const [chunk, setChunk] = useState<EvidenceChunk | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  /**
   * useRef 的泛型参数 `<HTMLButtonElement>` 描述“这个 ref 将来会指向哪种 DOM 元素”。
   * 初始值必须是 null；React 渲染时会把真实按钮节点写进 ref.current。
   *
   * 为什么不用 document.querySelector？
   * ref 只指向当前组件自己的按钮，不会误选页面上的其他节点，
   * 而且组件卸载后 React 会自动把 current 置空。
   */
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  /**
   * 打开时锁定页面滚动，关闭/卸载时恢复。
   *
   * 依赖数组为空 []：只在挂载和卸载时执行。
   * 注意组件如果被 React 严格模式重复挂载，这里也会成对执行，不会永久锁住滚动。
   */
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  /** 打开后把焦点移到关闭按钮。 */
  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [])

  /** 支持 Esc 关闭。 */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  /**
   * 读取当前 offset 对应的证据片段。
   *
   * offset 变化（上一页/下一页）或 retryKey 变化（点击重试）时重新请求。
   * 请求期间如果组件卸载或参数变化，用 AbortController 中止旧请求。
   */
  useEffect(() => {
    const controller = new AbortController()
    let disposed = false

    setLoading(true)
    setError(null)
    setNotFound(false)

    api
      .getEvidence(taskId, evidenceId, offset, EVIDENCE_PAGE_LIMIT, controller.signal)
      .then((result) => {
        if (disposed) return
        setChunk(result)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (disposed || controller.signal.aborted) return
        setLoading(false)
        setChunk(null)

        if (isNotFoundError(err)) {
          setNotFound(true)
          return
        }

        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      disposed = true
      controller.abort()
    }
  }, [taskId, evidenceId, offset, retryKey])

  /**
   * 计算是否还有下一页。
   *
   * 优先用 total_chars 判断；如果后端没给总长度，就只看 truncated。
   * 两个信息都没有时，不显示“下一页”，避免让用户点进空片段。
   */
  /*
    `chunk?.content.length ?? 0`：
    chunk 为 null 时 `?.` 让整个表达式得到 undefined，
    `?? 0` 再把它变成 0，后面做加法不会变成 NaN。
  */
  const contentLength = chunk?.content.length ?? 0
  const start = chunk?.offset ?? offset
  const end = start + contentLength

  /*
    后端 offset 从 0 开始，但给用户看“第几个字符”时从 1 开始更自然。
    例如 offset=0、content 长度 4000：
    - 后端语义：取了 [0, 4000) 这 4000 个字符；
    - 页面显示：第 1 – 4,000 个字符。
    内容为空时不做 +1，避免出现“第 16001 – 16000 个字符”这种倒挂区间。
  */
  const displayStart = contentLength > 0 ? start + 1 : start

  // 有总长度时按总长度判断；没有总长度时才退回 truncated 标记。
  const hasNext =
    chunk !== null &&
    contentLength > 0 &&
    (chunk.total_chars !== null && chunk.total_chars !== undefined
      ? start + contentLength < chunk.total_chars
      : chunk.truncated === true)

  /**
   * `MouseEvent<HTMLDivElement>` 是 React 自己的鼠标事件类型，
   * 泛型参数表示事件绑定在 div 上。注意要从 'react' 里 import type，
   * 不要和浏览器全局的 MouseEvent 混用，两者字段不完全一样。
   *
   * 事件冒泡：点击抽屉内部的按钮，事件也会冒泡到遮罩这一层。
   * `event.target` 是真正被点的元素，`event.currentTarget` 是绑定
   * onClick 的遮罩元素；只有两者相等，才说明点的是遮罩空白区域。
   */
  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose()
  }

  return (
    <div className="drawer-overlay" role="presentation" onClick={handleOverlayClick}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-drawer-title"
      >
        <div className="drawer__header">
          <div className="drawer__title-block">
            <div className="drawer__eyebrow">
              <FileIcon size={14} />
              证据预览
            </div>
            <h2 id="evidence-drawer-title" className="drawer__title" title={evidenceId}>
              {evidenceId}
            </h2>
          </div>
          <button
            type="button"
            ref={closeButtonRef}
            className="icon-button"
            onClick={onClose}
            aria-label="关闭证据预览"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="drawer__meta">
          <span>
            字符区间（从 1 开始）：{formatNumber(displayStart)} – {formatNumber(end)}
          </span>
          <span>
            总长度：{formatNumber(chunk?.total_chars ?? null)}
            {chunk?.total_chars === null || chunk?.total_chars === undefined ? '（后端未返回）' : ''}
          </span>
          <span>单次上限：{formatNumber(EVIDENCE_PAGE_LIMIT)}</span>
        </div>

        <div className="drawer__body">
          {loading ? <div className="drawer__loading">正在读取证据片段…</div> : null}

          {notFound ? (
            <Notice tone="warning">后端没有找到这条证据（404）。可能已被清理，或 evidence_id 不正确。</Notice>
          ) : null}

          {error ? (
            <Notice tone="error">
              证据读取失败：{error}
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => setRetryKey((key) => key + 1)}
              >
                重试
              </button>
            </Notice>
          ) : null}

          {!loading && !notFound && !error && chunk ? (
            chunk.content ? (
              <pre className="drawer__content">{chunk.content}</pre>
            ) : (
              <div className="drawer__loading">这一片段没有内容。</div>
            )
          ) : null}
        </div>

        <div className="drawer__footer">
          <div className="drawer__pager">
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => setOffset((current) => Math.max(0, current - EVIDENCE_PAGE_LIMIT))}
              disabled={loading || offset === 0}
            >
              上一段
            </button>
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => setOffset((current) => current + Math.max(contentLength, 1))}
              disabled={loading || !hasNext}
            >
              下一段
            </button>
          </div>

          {chunk?.truncated ? (
            <span className="drawer__truncated">后端标记此片段被截断</span>
          ) : null}

          <button type="button" className="button button--primary button--small" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

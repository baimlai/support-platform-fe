/**
 * ============================================================================
 * Topic 面板（Agent 当前掌握的问题与线索）
 * ============================================================================
 *
 * Topic 是后端持久化的“排查主题”，通常包含：
 * - question：当前要回答的问题；
 * - scope：排查范围（实例、时间窗口等）；
 * - facts：已经确认的事实，以及支撑它们的证据；
 * - candidates：候选原因，以及支持/反驳证据；
 * - open_questions：还没解决的问题；
 * - next_steps：下一步计划。
 *
 * 页面只展示后端返回的内容。Topic 为空时显示空状态，不自动生成一份“看起来合理”的模板。
 *
 * 显示约定：
 * - 事实、候选原因、未解决问题、下一步分别展示，不混在一起；
 * - 候选原因的支持证据和反证用不同颜色区分；
 * - 证据引用统一打开有界预览抽屉。
 */

import type { TopicCandidate, TopicFact, TopicView } from '../api/types'
import { formatDateTime } from '../utils/format'
import { EmptyState } from './EmptyState'
import { FileIcon } from './icons'

interface TopicPanelProps {
  topic: TopicView | null
  onOpenEvidence: (evidenceId: string) => void
}

/**
 * 候选原因的状态标签。
 *
 * `Record<string, string>` 是 TypeScript 内置的泛型工具类型：
 * 它表示“键是 string、值也是 string 的对象”。
 *
 * 为什么不用普通对象？
 * 普通对象 `{ supported: '已支持' }` 的键被推断成固定的几个字面量，
 * 用 `CANDIDATE_STATUS_LABEL[任意字符串]` 会报“没有这个键”。
 * Record<string, string> 明确告诉编译器：任意字符串键都可能有值，
 * 取不到时运行时得到 undefined，下面用 `??` 兜底。
 */
const CANDIDATE_STATUS_LABEL: Record<string, string> = {
  supported: '已支持',
  confirmed: '已确认',
  // 真实后端用 candidate 表示“只是候选，还没有证据把它推到 supported”。
  candidate: '候选',
  // 真实后端用 unverified 表示“目前无法确认，也不能排除”。
  // 注意别把它翻译成“已排除”，两者语义相反。
  unverified: '待验证',
  rejected: '已排除',
  refuted: '已排除',
  open: '待验证',
  pending: '待验证',
  unknown: '状态未知',
}

/**
 * 把后端状态转成中文标签。
 *
 * 参数类型是 `string | undefined`：后端可能没给 status。
 * 返回类型是 `string | null`：调用方拿到 null 就不渲染标签。
 *
 * `status.toLowerCase()` 让 SUPPORTED / Supported 也能匹配；
 * `?? status` 表示“表里找不到就直接显示后端原值”，不吞掉未知状态。
 */
function candidateStatusLabel(status: string | undefined): string | null {
  if (!status) return null
  return CANDIDATE_STATUS_LABEL[status.toLowerCase()] ?? status
}

/**
 * 证据引用按钮组。
 *
 * `tone?: 'default' | 'support' | 'against'` 有三个要点：
 * - `?` 表示这个参数可选，调用方可以不传；
 * - 联合类型 `'default' | ...` 限制只能传这三个字符串之一，
 *   写 `tone="red"` 会直接编译报错；
 * - `tone = 'default'` 是默认值，不传时自动用 'default'。
 *
 * 注意：可选参数加默认值后，函数体里 tone 一定是有值的，
 * 不需要再判断 undefined。
 */
function EvidenceRefs({
  refs,
  onOpenEvidence,
  tone = 'default',
}: {
  refs: string[]
  onOpenEvidence: (evidenceId: string) => void
  tone?: 'default' | 'support' | 'against'
}) {
  if (refs.length === 0) return null

  return (
    <span className="evidence-refs">
      {refs.map((ref) => (
        <button
          type="button"
          key={ref}
          /*
            模板字符串拼 class：
            `evidence-ref evidence-ref--${tone}`
            会得到 'evidence-ref evidence-ref--support' 这样的结果，
            CSS 里就能按 tone 写不同颜色。
          */
          className={`evidence-ref evidence-ref--${tone}`}
          onClick={() => onOpenEvidence(ref)}
          title={`查看证据 ${ref}`}
        >
          <FileIcon size={12} />
          {ref}
        </button>
      ))}
    </span>
  )
}

/**
 * 单条已确认事实。
 *
 * 参数类型 `{ fact: TopicFact; onOpenEvidence: (ref: string) => void }`
 * 说明 fact 不是随便的对象，必须符合 TopicFact 的结构。
 */
function FactItem({ fact, onOpenEvidence }: { fact: TopicFact; onOpenEvidence: (ref: string) => void }) {
  return (
    <li className="topic__fact">
      <span>{fact.text}</span>
      <EvidenceRefs refs={fact.evidence_refs} onOpenEvidence={onOpenEvidence} />
    </li>
  )
}

/** 单条候选原因，包含支持证据和反证。 */
function CandidateItem({
  candidate,
  onOpenEvidence,
}: {
  candidate: TopicCandidate
  onOpenEvidence: (ref: string) => void
}) {
  const statusLabel = candidateStatusLabel(candidate.status)

  return (
    <li className="topic__candidate">
      <div className="topic__candidate-head">
        <span>{candidate.text}</span>
        {statusLabel ? <span className="tag">{statusLabel}</span> : null}
      </div>

      {candidate.support_refs.length > 0 ? (
        <div className="topic__ref-row">
          <span className="topic__ref-label">支持</span>
          <EvidenceRefs refs={candidate.support_refs} onOpenEvidence={onOpenEvidence} tone="support" />
        </div>
      ) : null}

      {candidate.against_refs.length > 0 ? (
        <div className="topic__ref-row">
          <span className="topic__ref-label">反证</span>
          <EvidenceRefs refs={candidate.against_refs} onOpenEvidence={onOpenEvidence} tone="against" />
        </div>
      ) : null}
    </li>
  )
}

export function TopicPanel({ topic, onOpenEvidence }: TopicPanelProps) {
  /*
    提前返回：topic 为 null 时只渲染空状态。
    后面的代码因此可以安全地访问 topic.question 等字段。
    这也是 TypeScript 类型收窄的典型场景：
    经过 `if (!topic) return ...` 之后，topic 的类型从
    `TopicView | null` 变成 `TopicView`。
  */
  if (!topic) {
    return (
      <section className="panel topic">
        <div className="panel__header">
          <div>
            <div className="panel__eyebrow">持久化</div>
            <h2 className="panel__title">Topic</h2>
          </div>
        </div>
        <EmptyState
          title="Topic 尚未生成"
          description="后端还没有返回 Topic。任务运行中可能会在后续轮次生成，稍后刷新或等待轮询更新。"
        />
      </section>
    )
  }

  /*
    判断 Topic 是否“真的有内容”。
    为什么要单独判断？
    后端可能返回一个对象，但所有字段都是空的。如果直接渲染，
    页面会出现一个只有标题的空壳，用户会以为内容丢失了。
    这里把所有字段用 `||` 串起来：任意一个有内容就算有内容。
  */
  const hasContent =
    topic.question !== '' ||
    topic.scope !== '' ||
    topic.facts.length > 0 ||
    topic.candidates.length > 0 ||
    topic.open_questions.length > 0 ||
    topic.next_steps.length > 0 ||
    topic.attempted_tools.length > 0

  if (!hasContent) {
    return (
      <section className="panel topic">
        <div className="panel__header">
          <div>
            <div className="panel__eyebrow">持久化</div>
            <h2 className="panel__title">Topic</h2>
          </div>
        </div>
        <EmptyState
          title="Topic 没有内容"
          description="后端返回了 Topic 对象，但里面没有可展示的字段。可以展开底部原始数据查看。"
        />
        <details className="raw-details">
          <summary>原始 Topic 数据</summary>
          <pre>{JSON.stringify(topic.raw, null, 2)}</pre>
        </details>
      </section>
    )
  }

  return (
    <section className="panel topic">
      <div className="panel__header">
        <div>
          <div className="panel__eyebrow">持久化</div>
          <h2 className="panel__title">Topic</h2>
        </div>
        <div className="topic__meta">
          {/*
            version 可能是数字 0，所以不能写 `topic.version ? ...`。
            显式判断 null/undefined 才能正确显示 v0。
          */}
          {topic.version !== null && topic.version !== undefined ? (
            <span className="tag">v{topic.version}</span>
          ) : null}
          {/* updated_at 为空时整个标签不渲染，而不是显示一个空的“标签”。 */}
          {topic.updated_at ? <span className="tag tag--muted">{formatDateTime(topic.updated_at)}</span> : null}
        </div>
      </div>

      {topic.question ? (
        <div className="topic__question">
          <div className="topic__label">当前问题</div>
          <p>{topic.question}</p>
        </div>
      ) : null}

      {topic.scope ? (
        <div className="topic__scope">
          <span className="topic__label">范围</span>
          <span>{topic.scope}</span>
        </div>
      ) : null}

      {/*
        已尝试工具：后端在 Topic 里记录本轮真的调用过哪些工具。
        这比“能力目录”更有信息量：目录只说明注册了什么，这里说明实际用了什么。
        `key={tool}` 直接用工具名：一次 Topic 里工具名不会重复，
        所以可以安全地当 React 的列表 key。
      */}
      {topic.attempted_tools.length > 0 ? (
        <div className="topic__scope">
          <span className="topic__label">已尝试工具</span>
          <span className="topic__tool-tags">
            {topic.attempted_tools.map((tool) => (
              <code key={tool} className="tag tag--muted">
                {tool}
              </code>
            ))}
          </span>
        </div>
      ) : null}

      {topic.facts.length > 0 ? (
        <div className="topic__section">
          <h3 className="section-title">
            已确认事实
            <span className="section-title__count">{topic.facts.length}</span>
          </h3>
          <ul className="topic__list">
            {topic.facts.map((fact, index) => (
              <FactItem key={`${fact.text}-${index}`} fact={fact} onOpenEvidence={onOpenEvidence} />
            ))}
          </ul>
        </div>
      ) : null}

      {topic.candidates.length > 0 ? (
        <div className="topic__section">
          <h3 className="section-title">
            候选原因
            <span className="section-title__count">{topic.candidates.length}</span>
          </h3>
          <ul className="topic__list">
            {topic.candidates.map((candidate, index) => (
              <CandidateItem
                key={`${candidate.text}-${index}`}
                candidate={candidate}
                onOpenEvidence={onOpenEvidence}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {topic.open_questions.length > 0 ? (
        <div className="topic__section">
          <h3 className="section-title">未解决问题</h3>
          <ul className="topic__list topic__list--plain">
            {topic.open_questions.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {topic.next_steps.length > 0 ? (
        <div className="topic__section">
          <h3 className="section-title">下一步</h3>
          <ul className="topic__list topic__list--plain">
            {topic.next_steps.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="raw-details">
        <summary>原始 Topic 数据</summary>
        <pre>{JSON.stringify(topic.raw, null, 2)}</pre>
      </details>
    </section>
  )
}

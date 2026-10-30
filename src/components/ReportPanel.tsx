/**
 * ============================================================================
 * 最终报告
 * ============================================================================
 *
 * 产品要求：报告打开后，第一眼必须看到“结论”，而不是一堆现象和排查过程。
 * 因此这里不再把整段 Markdown 一次性铺开，而是做四层展示：
 *
 * 1. 结论区（Hero）：主根因、置信度、直接证据、结论边界；
 * 2. 修复建议：紧跟在结论后面，优先展示“首选方案”；
 * 3. 折叠区：证据链、已排除与待验证、调查过程、验证方法、当前限制；
 * 4. 兜底区：完整 Markdown 原文和原始 JSON，保证任何内容都不会丢。
 *
 * 报告可能有两种形态：
 * - markdown 正文（后端 v0 的常见形态）；
 * - 结构化字段（summary / evidence / recommendations / verification / limitations）。
 *
 * 页面优先渲染 markdown；如果 markdown 为空，就退回到 summary 段落。
 * 结构化字段作为补充信息继续展示，不会丢。
 *
 * 报告为空时按任务状态区分：
 * - 任务还没结束：提示“结束后生成”；
 * - 任务已经结束：提示“后端未返回报告”，而不是编一份报告。
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { FinalReport } from '../api/types'
import { isTerminalStatus } from '../api/normalize'
import {
  extractEvidenceRefs,
  organizeReportSections,
  parseConclusionSection,
  parseReportMarkdown,
  stripInlineMarkdown,
  stripLeadingHeading,
} from '../utils/reportMarkdown'
import { EmptyState } from './EmptyState'
import { Markdown } from './Markdown'
import { AlertIcon, ChevronIcon, CopyIcon, FileIcon } from './icons'
import { copyText } from '../utils/format'

/**
 * 报告面板的参数。
 *
 * `report` 可能是 null：接口返回 404、任务还没结束、或者后端返回了空壳，
 * 都会走到 null。组件必须能处理“没有报告”的状态，不能假设一定有数据。
 */
interface ReportPanelProps {
  report: FinalReport | null
  /** 任务状态，用于区分“还没结束”和“已结束但没有报告”。 */
  taskStatus: string | null
  onOpenEvidence: (evidenceId: string) => void
}

/**
 * 一组不带标题的文本列表。
 *
 * 参数类型直接写在花括号里，没有单独定义 interface：
 *   { items: string[] }
 * 这叫“内联对象类型”，适合这种只在一个地方使用的小组件。
 *
 * 组件返回 `null` 是合法的 React 返回值，表示“什么都不渲染”。
 * 这里列表为空时直接返回 null，父组件不用再判断一次。
 */
function TextList({ items }: { items: string[] }) {
  if (items.length === 0) return null

  return (
    <ul className="report__list">
      {items.map((item, index) => (
        /*
          key 用“文本 + 下标”组合，避免两条一样的建议产生重复 key。
          如果后端文本重复，只写 item 会触发 React 的 key 警告，
          加上 index 可以保证同一份列表里 key 唯一。
        */
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  )
}

/**
 * 带标题的结构化文本列表。
 *
 * 只在“报告没有 Markdown 分节”或“报告正文为空”时使用，
 * 用来兼容更早的后端返回：它可能只给 recommendations / verification 数组。
 */
function TextSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null

  return (
    <div className="report__section">
      <h3 className="section-title">{title}</h3>
      <TextList items={items} />
    </div>
  )
}

/**
 * 报告里的证据引用列表。
 *
 * `items: FinalReport['evidence']` 是 TypeScript 的“索引访问类型”：
 * 从 FinalReport 这个接口里取出 evidence 字段的类型，不用再重复写一遍
 * `{ ref: string; note?: string }[]`。以后后端证据结构变了，这里自动跟着变。
 *
 * onClick 里传的是 `() => onOpenEvidence(item.ref)`，
 * 不能写成 `onOpenEvidence(item.ref)`，否则渲染时就会立刻执行，
 * 而不是等用户点击。
 */
function EvidenceRefList({
  items,
  onOpenEvidence,
}: {
  items: FinalReport['evidence']
  onOpenEvidence: (evidenceId: string) => void
}) {
  if (items.length === 0) return null

  return (
    <ul className="report__evidence">
      {items.map((item, index) => (
        <li key={`${item.ref}-${index}`}>
          <button
            type="button"
            className="evidence-ref evidence-ref--default"
            onClick={() => onOpenEvidence(item.ref)}
          >
            <FileIcon size={12} />
            {item.ref}
          </button>
          {/* note 是可选的，只有后端给了才渲染。 */}
          {item.note ? <span className="report__evidence-note">{item.note}</span> : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * 可点击的证据编号按钮组。
 *
 * 结论里写着“直接证据：`ev-000001`、`ev-000002`”时，直接把编号变成按钮，
 * 用户不用往下翻证据列表，点一下就能打开证据抽屉。
 *
 * `refs` 已经由 `extractEvidenceRefs` 去重，所以这里直接用 ref 当 key。
 */
function EvidenceChips({
  refs,
  onOpenEvidence,
  label = '直接证据',
}: {
  refs: string[]
  onOpenEvidence: (evidenceId: string) => void
  label?: string
}) {
  if (refs.length === 0) return null

  return (
    <div className="report-hero__evidence">
      <span className="report-hero__evidence-label">{label}</span>
      <div className="report-hero__refs">
        {refs.map((ref) => (
          <button
            key={ref}
            type="button"
            className="evidence-ref evidence-ref--default"
            onClick={() => onOpenEvidence(ref)}
          >
            <FileIcon size={11} />
            {ref}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * 通用折叠区。
 *
 * 这里用原生 `<details>` / `<summary>`，不引入额外的折叠组件：
 * - 浏览器自带展开/收起和键盘可访问性；
 * - 不需要在 React 里维护 open state；
 * - 报告是静态内容，用原生元素最省事。
 *
 * `tone="warning"` 用来标记“已排除与待验证”，提醒用户这里有没闭环的内容。
 */
function ReportDisclosure({
  title,
  meta,
  tone = 'default',
  children,
}: {
  title: string
  meta?: string
  tone?: 'default' | 'warning'
  children: ReactNode
}) {
  return (
    <details className={`report-disclosure${tone === 'warning' ? ' report-disclosure--warning' : ''}`}>
      <summary className="report-disclosure__summary">
        <span className="report-disclosure__chevron">
          <ChevronIcon size={13} />
        </span>
        <span className="report-disclosure__title">{title}</span>
        {meta ? <span className="report-disclosure__meta">{meta}</span> : null}
      </summary>
      <div className="report-disclosure__body">{children}</div>
    </details>
  )
}

/**
 * 把置信度文字归成三种展示状态。
 *
 * 报告可能写“中”“低”“高”，也可能写英文 medium / low / high。
 * 判断顺序是“低 -> 高 -> 中”，避免“中高”这种文字被误判成“中”。
 * 如果报告没写置信度，返回 unknown，页面显示灰色徽标，而不是猜一个值。
 */
function confidenceTone(value: string): 'high' | 'medium' | 'low' | 'unknown' {
  const text = stripInlineMarkdown(value)
  if (!text) return 'unknown'
  if (/低|low/i.test(text)) return 'low'
  if (/高|high/i.test(text)) return 'high'
  if (/中|medium/i.test(text)) return 'medium'
  return 'unknown'
}

/**
 * 结论区（Hero）。
 *
 * 数据来源是 Markdown 的“## 结论”章节，解析工作交给
 * `utils/reportMarkdown.ts`，这里只负责排版：
 *
 * - 主根因字体最大，是第一视觉焦点；
 * - 置信度做成颜色徽标（高=绿、中=黄、低=红）；
 * - 直接证据做成可点击按钮；
 * - 结论边界单独放在浅色提示框里；
 * - 候选原因只在报告真的列出时显示，页面不会自己编。
 */
function ConclusionHero({
  section,
  onOpenEvidence,
}: {
  section: { title: string; content: string }
  onOpenEvidence: (evidenceId: string) => void
}) {
  const view = parseConclusionSection(section.content)

  /**
   * `showParsed` 表示“确实解析出了根因正文”。
   *
   * 如果模型没按 `**最可能根因：**` 的格式写，解析结果会退回整段正文，
   * 此时 rootCause 仍然有值；只有正文完全为空时才显示原始章节内容。
   * 这里用 Boolean 转成 true/false，JSX 里读起来更直观。
   */
  const showParsed = Boolean(view.rootCause)

  // 优先用“直接证据”字段里的编号；没有的话再从根因正文里找。
  const directRefs = extractEvidenceRefs(view.evidenceText)
  const refs = directRefs.length > 0 ? directRefs : extractEvidenceRefs(view.rootCause)

  const tone = confidenceTone(view.confidence)
  const confidenceText = stripInlineMarkdown(view.confidence) || '未给出'

  return (
    <section className="report-hero" aria-label="调查结论">
      <div className="report-hero__topline">
        <span className="report-hero__eyebrow">调查结论</span>
        {view.hasLabels ? null : <span className="report-hero__format-note">未使用标准结论字段</span>}
      </div>

      {showParsed ? (
        <>
          <div className="report-hero__label">{view.rootCauseLabel}</div>
          <div className="report-hero__statement">
            <Markdown content={view.rootCause} />
          </div>
        </>
      ) : (
        /*
          连根因正文都没有时，直接把原章节交给 Markdown 渲染。
          这样即使报告格式完全不符合预期，内容也不会被吞掉。
        */
        <div className="report-hero__statement">
          <Markdown content={section.content} />
        </div>
      )}

      <div className="report-hero__meta">
        <span className={`report-confidence report-confidence--${tone}`}>置信度 {confidenceText}</span>
      </div>

      <EvidenceChips refs={refs} onOpenEvidence={onOpenEvidence} />

      {/*
        直接证据里没有 ev-xxxxxx 编号，但报告写了“见证据链”之类文字时，
        仍然把原文显示出来，避免“有说明但页面没显示”。
      */}
      {showParsed && view.evidenceText && refs.length === 0 ? (
        <div className="report-hero__evidence-text">
          <span className="report-hero__evidence-label">直接证据</span>
          <div className="report-hero__evidence-value">
            <Markdown content={view.evidenceText} />
          </div>
        </div>
      ) : null}

      {showParsed && view.boundary ? (
        <div className="report-hero__boundary">
          <span className="report-hero__boundary-label">结论边界</span>
          <div className="report-hero__boundary-text">
            <Markdown content={view.boundary} />
          </div>
        </div>
      ) : null}

      {showParsed && view.candidates.length > 0 ? (
        <div className="report-hero__candidates">
          <div className="report-hero__candidates-title">
            候选原因
            <span className="report-hero__candidates-hint">证据不足时按可能性排序</span>
          </div>
          <ol className="report-hero__candidate-list">
            {view.candidates.map((candidate, index) => (
              <li key={`${candidate}-${index}`}>
                <Markdown content={candidate} />
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {showParsed && view.phenomenon ? (
        <details className="report-hero__details">
          <summary>工单现象与调查范围</summary>
          <div className="report-hero__details-body">
            <Markdown content={view.phenomenon} />
          </div>
        </details>
      ) : null}

      {showParsed && view.extraBlocks.length > 0 ? (
        <details className="report-hero__details">
          <summary>结论补充</summary>
          <div className="report-hero__details-body">
            {view.extraBlocks.map((block, index) => (
              <div className="report-hero__extra-block" key={`${block.label}-${index}`}>
                <div className="report-hero__extra-label">{block.label}</div>
                <Markdown content={block.body} />
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  )
}

/**
 * 旧格式 / 不合规报告的兜底结论区。
 *
 * 有些历史报告没有 `## 结论`，而是直接写“## 现象”“## 候选原因”。
 * 这时不能把候选原因当成确定根因展示，否则会误导用户。
 * 页面采取的做法是：
 * - 明确提示“报告没有单独结论”；
 * - 把最接近结论的原文章节（候选原因 > 现象 > 第一个未知章节）原样展示；
 * - 下方仍然提供完整原文，用户可以看到全文。
 */
function FallbackConclusionCard({
  section,
  summary,
  onOpenEvidence,
}: {
  section: { title: string; content: string } | null
  summary: string
  onOpenEvidence: (evidenceId: string) => void
}) {
  // 优先从选中的章节里找证据；没有章节时再看结构化 summary。
  const content = section?.content.trim() || summary.trim()
  const refs = extractEvidenceRefs(section?.content ?? '', summary)

  return (
    <section className="report-hero report-hero--fallback" aria-label="调查报告未给出单独结论">
      <div className="report-hero__eyebrow">调查结论</div>

      <div className="report-hero__fallback-head">
        <span className="report-hero__fallback-icon">
          <AlertIcon size={16} />
        </span>
        <div>
          <div className="report-hero__fallback-title">报告未按标准给出单独结论</div>
          <p className="report-hero__fallback-note">
            这份报告没有 <code>## 结论</code> 章节，可能来自旧版格式，或者模型没有遵守输出要求。
            下面原样展示报告中最接近结论的内容，没有把它改写成确定根因。
          </p>
        </div>
      </div>

      {content ? (
        <div className="report-hero__fallback-body">
          {section ? (
            <div className="report-hero__fallback-source">原报告章节：{section.title}</div>
          ) : null}
          <Markdown content={content} />
        </div>
      ) : (
        <p className="report-hero__fallback-note">报告没有可用于展示的结论内容。</p>
      )}

      <EvidenceChips refs={refs} onOpenEvidence={onOpenEvidence} label="相关证据" />
    </section>
  )
}

/**
 * 修复建议卡片。
 *
 * 两种内容来源：
 * - `markdown`：后端报告里的“## 修复建议”章节；
 * - `children`：后端只返回结构化 recommendations 数组时，用 TextList 渲染。
 *
 * 卡片本身不做折叠：结论之后紧接着看到“怎么修”，是页面的第二视觉重点。
 * 内部的“### 首选方案 / ### 备选方案 / ### 临时缓解”仍然是 Markdown 标题，
 * 由 CSS 渲染成小标签，读者可以快速区分优先级。
 */
function FixCard({ markdown, children }: { markdown?: string; children?: ReactNode }) {
  return (
    <section className="report-fix" aria-label="修复建议">
      <div className="report-fix__eyebrow">建议行动</div>
      <h3 className="report-fix__title">修复建议</h3>
      <div className="report-fix__body">{markdown ? <Markdown content={markdown} /> : children}</div>
    </section>
  )
}

export function ReportPanel({ report, taskStatus, onOpenEvidence }: ReportPanelProps) {
  /**
   * copied 是一个布尔 state，控制按钮文案显示“已复制”还是“复制报告”。
   * 初始值是 false，TypeScript 会推断成 boolean。
   */
  const [copied, setCopied] = useState(false)

  /**
   * 提前返回（early return）：
   * 没有报告时直接渲染空状态，下面的代码就都能假设 report 不是 null。
   *
   * TypeScript 的控制流分析会记住这个判断：
   * 在 `if (!report) return ...` 之后，report 的类型会自动收窄为 FinalReport，
   * 所以后面写 report.markdown 不会报“可能为 null”。
   */
  if (!report) {
    const terminal = isTerminalStatus(taskStatus)

    return (
      <section className="panel report">
        <div className="panel__header">
          <div>
            <div className="panel__eyebrow">输出</div>
            <h2 className="panel__title">最终报告</h2>
          </div>
        </div>
        <EmptyState
          title={terminal ? '后端未返回最终报告' : '报告将在任务结束后生成'}
          description={
            terminal
              ? '任务已经结束，但 /report 接口没有返回内容（或返回 404）。可以点击页面上方“刷新”重试。'
              : '任务运行中还没有最终报告。可以继续查看时间线和 Topic。'
          }
        />
      </section>
    )
  }

  /*
    `markdown.trim() || summary.trim()` 的含义：
    markdown 去掉首尾空格后如果是空字符串，`||` 会继续取右边的 summary。
    这是“优先 markdown，没有正文就用摘要”的简写。
    如果两个都为空，body 就是空字符串，下面会显示“报告没有正文”。
  */
  const body = report.markdown.trim() || report.summary.trim()

  /**
   * 解析报告。这里每次渲染都会重新算一遍，但报告只是一段几 KB 的文本，
   * 计算量很小；不引入 useMemo 反而少一层理解成本。
   *
   * `parsed.sections` 是按 `##` 切出来的章节；
   * `organized` 再按“结论 / 修复建议 / 证据链 / ...”分类；
   * `preamble` 是第一个二级标题之前的说明文字（通常只有一级标题）。
   */
  const parsed = parseReportMarkdown(body)
  const organized = organizeReportSections(parsed.sections)
  const hasSections = parsed.sections.length > 0
  const preamble = stripLeadingHeading(parsed.preamble)

  /**
   * 没有“## 结论”时的兜底章节。
   *
   * 优先级：候选原因 > 现象 > 第一个未知章节。
   * 用 `??` 而不是 `||`：这些值要么是 ReportSection 对象，要么是 null，
   * 不会出现“空字符串也算假值”的误判。
   */
  const fallbackSection = !organized.conclusion
    ? organized.candidates ?? organized.phenomenon ?? organized.others[0] ?? null
    : null

  /**
   * 结构化 summary 只在“和 markdown 正文不一样”时才拿来兜底。
   * 后端 v0 的 summary 就是 markdown 本身，如果直接展示会重复一整份报告。
   */
  const fallbackSummary =
    !organized.conclusion && report.summary.trim() && report.summary.trim() !== body
      ? report.summary.trim()
      : ''

  /**
   * 如果某个章节被拿去做了兜底结论区，就不要在下方折叠区再显示一遍。
   * 这里比较的是对象引用：fallbackSection 就是从 organized 里取出来的同一个对象。
   */
  const otherSections = organized.others.filter((section) => section !== fallbackSection)

  /**
   * 复制按钮的处理函数。
   *
   * `async` 函数一定返回 Promise。copyText 内部已经捕获错误，
   * 返回 true/false，所以这里不会抛异常。
   *
   * 复制成功后 1.5 秒把 copied 改回 false，按钮文案自动恢复。
   * 注意：组件卸载后 setTimeout 仍可能执行 setCopied，
   * 对这个小组件影响很小；如果要严格处理，可以把 timer 存进 ref 并在
   * useEffect 的清理函数里 clearTimeout。
   */
  const handleCopy = async () => {
    const ok = await copyText(body)
    setCopied(ok)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="panel report">
      <div className="panel__header">
        <div>
          <div className="panel__eyebrow">输出</div>
          <h2 className="panel__title">最终报告</h2>
        </div>
        {/*
          只有存在正文时才显示复制按钮，避免用户点一个复制不到东西的按钮。
          `onClick={() => void handleCopy()}`：
          - 用箭头函数包一层，保证点击时才执行；
          - `void` 表示“我知道它返回 Promise，但我故意不 await”，
            用来消除“Promise 未处理”的 lint 提示。
        */}
        {body ? (
          <button type="button" className="button button--ghost button--small" onClick={() => void handleCopy()}>
            <CopyIcon size={14} />
            {copied ? '已复制' : '复制报告'}
          </button>
        ) : null}
      </div>

      {body ? (
        hasSections ? (
          <>
            {/*
              第一视觉焦点：结论。
              有标准“## 结论”就渲染结构化 Hero；
              没有就渲染“旧格式兜底”，绝不把候选原因说成确定根因。
            */}
            {organized.conclusion ? (
              <ConclusionHero section={organized.conclusion} onOpenEvidence={onOpenEvidence} />
            ) : (
              <FallbackConclusionCard
                section={fallbackSection}
                summary={fallbackSummary}
                onOpenEvidence={onOpenEvidence}
              />
            )}

            {/*
              前言通常是“本轮为模拟数据”这类环境说明。
              放在结论后面，既保留上下文，又不抢结论的第一视觉位置。
            */}
            {preamble ? (
              <div className="report-preamble">
                <Markdown content={preamble} />
              </div>
            ) : null}

            {/*
              第二视觉焦点：修复建议。
              如果 Markdown 没有“## 修复建议”，但后端给了结构化 recommendations，
              就用结构化数组补一张同样的卡片，保证用户仍然能看到“怎么修”。
            */}
            {organized.fix ? (
              <FixCard markdown={organized.fix.content} />
            ) : report.recommendations.length > 0 ? (
              <FixCard>
                <TextList items={report.recommendations} />
              </FixCard>
            ) : null}

            {/*
              其余内容全部放进原生折叠区，默认收起。
              这样页面首屏只保留“结论 + 修复建议”，不会被证据表格和排查过程淹没。
            */}
            <div className="report-disclosures">
              {organized.excluded ? (
                <ReportDisclosure
                  title={organized.excluded.title}
                  meta="已排除 + 待验证"
                  tone="warning"
                >
                  <Markdown content={organized.excluded.content} />
                </ReportDisclosure>
              ) : null}

              {organized.evidence ? (
                <ReportDisclosure title={organized.evidence.title} meta="支撑结论">
                  <Markdown content={organized.evidence.content} />
                </ReportDisclosure>
              ) : null}

              {report.evidence.length > 0 ? (
                <ReportDisclosure title="证据引用" meta={`${report.evidence.length} 条`}>
                  <EvidenceRefList items={report.evidence} onOpenEvidence={onOpenEvidence} />
                </ReportDisclosure>
              ) : null}

              {organized.verification ? (
                <ReportDisclosure title={organized.verification.title} meta="如何验证">
                  <Markdown content={organized.verification.content} />
                </ReportDisclosure>
              ) : report.verification.length > 0 ? (
                <ReportDisclosure title="验证方法" meta="结构化字段">
                  <TextList items={report.verification} />
                </ReportDisclosure>
              ) : null}

              {organized.limitations ? (
                <ReportDisclosure title={organized.limitations.title} meta="结论适用边界">
                  <Markdown content={organized.limitations.content} />
                </ReportDisclosure>
              ) : report.limitations.length > 0 ? (
                <ReportDisclosure title="当前限制" meta="结构化字段">
                  <TextList items={report.limitations} />
                </ReportDisclosure>
              ) : null}

              {organized.process ? (
                <ReportDisclosure title={organized.process.title} meta="审计记录">
                  <Markdown content={organized.process.content} />
                </ReportDisclosure>
              ) : null}

              {/*
                候选原因和现象通常已经在结论 Hero 里展示过：
                - 新格式：现象在“## 结论”内部，candidates 在结论内部；
                - 旧格式：可能被拿去做了 fallbackSection。
                只有它们独立成章节、又没有出现在 Hero 里时，才在这里补一个折叠区。
              */}
              {organized.candidates && organized.candidates !== fallbackSection ? (
                <ReportDisclosure title={organized.candidates.title} meta="候选假设">
                  <Markdown content={organized.candidates.content} />
                </ReportDisclosure>
              ) : null}

              {organized.phenomenon && organized.phenomenon !== fallbackSection ? (
                <ReportDisclosure title={organized.phenomenon.title} meta="工单事实">
                  <Markdown content={organized.phenomenon.content} />
                </ReportDisclosure>
              ) : null}

              {otherSections.map((section, index) => (
                <ReportDisclosure key={`${section.title}-${index}`} title={section.title} meta="其它章节">
                  <Markdown content={section.content} />
                </ReportDisclosure>
              ))}

              {/*
                最后再放一份完整 Markdown 原文。
                即使上面的分节规则以后遇到新格式没认出来，用户仍然能展开看全文，
                不会因为前端的展示逻辑丢内容。
              */}
              <ReportDisclosure title="完整报告原文" meta="Markdown">
                <div className="report__body">
                  <Markdown content={body} />
                </div>
              </ReportDisclosure>
            </div>
          </>
        ) : (
          /*
            没有任何二级标题：说明这是一份纯文本报告，按原样展示。
            结构化字段会在下面按旧版布局补充，不强行编造章节。
          */
          <div className="report__body">
            <Markdown content={body} />
          </div>
        )
      ) : (
        <EmptyState
          title="报告没有正文"
          description="后端返回了报告对象，但 markdown 和 summary 都是空的。可以展开底部原始数据查看。"
        />
      )}

      {/*
        报告没有分节时，结构化字段按旧版布局补在正文后面。
        有分节时，这些字段已经在对应章节或折叠区里展示，避免重复。
      */}
      {!hasSections ? (
        <>
          <TextSection title="建议" items={report.recommendations} />
          <TextSection title="如何验证" items={report.verification} />
          <TextSection title="限制与不确定项" items={report.limitations} />
          {report.evidence.length > 0 ? (
            <div className="report__section">
              <h3 className="section-title">
                证据引用
                <span className="section-title__count">{report.evidence.length}</span>
              </h3>
              <EvidenceRefList items={report.evidence} onOpenEvidence={onOpenEvidence} />
            </div>
          ) : null}
        </>
      ) : null}

      <details className="raw-details">
        <summary>原始报告数据</summary>
        <pre>{JSON.stringify(report.raw, null, 2)}</pre>
      </details>
    </section>
  )
}

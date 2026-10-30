/**
 * ============================================================================
 * 极简 Markdown 渲染器
 * ============================================================================
 *
 * 为什么不用 react-markdown：
 * - 当前报告只需要标题、段落、列表、代码块、链接和简单表格；
 * - 自己解析成 React 节点，不碰 innerHTML，避免把报告里的内容当 HTML 执行。
 *
 * 安全提醒：
 * 报告内容来自模型/后端，不能直接塞进 dangerouslySetInnerHTML。
 * 这里把 Markdown 解析成 React 元素，React 会自动转义文本，HTML 标签会被当成普通文字。
 *
 * 支持范围有限：不支持嵌套列表、图片和引用式链接。遇到不认识的写法按普通文本显示。
 *
 * 解析方式：
 * - 逐行切成块，再按块类型生成 React 元素；
 * - 列表项用索引做 key（报告是静态内容，顺序稳定）；
 * - 行内匹配用正则，只识别加粗、行内代码和 http/https 链接。
 */

import type { ReactNode } from 'react'

interface MarkdownProps {
  content: string
}

export function Markdown({ content }: MarkdownProps) {
  return <div className="markdown">{renderBlocks(content)}</div>
}

/**
 * 一个 Markdown 块。
 *
 * 这是“可辨识联合”的典型写法：每个成员都有 `type` 字段，
 * 但其他字段不同。读取时先看 type，再访问对应字段：
 *
 *   if (block.type === 'heading') {
 *     block.text    // ✅ 编译器知道 heading 有 text
 *     block.items   // ❌ 编译报错：heading 没有 items
 *   }
 *
 * `type: 'ul' | 'ol'` 表示无序列表和有序列表共用同一种结构，
 * 区别只在 type 的值。
 */
type Block = { type: 'heading'; level: number; text: string } | { type: 'paragraph'; lines: string[] } | { type: 'ul' | 'ol'; items: string[] } | { type: 'quote'; lines: string[] } | { type: 'code'; language: string; code: string } | { type: 'table'; header: string[]; rows: string[][] } | { type: 'hr' }

const HEADING_RE = /^(#{1,4})\s+(.*)$/
const UL_RE = /^\s*[-*+]\s+(.*)$/
const OL_RE = /^\s*\d+[.)]\s+(.*)$/
const QUOTE_RE = /^>\s?(.*)$/
const HR_RE = /^\s*(---+|\*\*\*+|___+)\s*$/

/**
 * 把 Markdown 源码切成块。
 *
 * 这是一个简单的“逐行状态机”：
 * - 读一行，判断它属于哪种块；
 * - 如果是代码块/列表/表格/引用，就继续往后读，直到这种块结束；
 * - 把块推进 blocks 数组，再继续下一行。
 *
 * 为什么不用一个巨大的正则？
 * 因为 Markdown 的块之间会互相影响（例如代码块里的 # 不是标题），
 * 逐行处理更容易控制边界，也更容易调试。
 *
 * `\r\n` 是 Windows 换行，先统一成 `\n`，后面只处理一种换行符。
 */
function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (trimmed === '') {
      index += 1
      continue
    }

    // 代码块：``` 开头，到下一个 ``` 结束；没闭合就吃到文末。
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim()
      index += 1
      const codeLines: string[] = []
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ type: 'code', language, code: codeLines.join('\n') })
      continue
    }

    const heading = HEADING_RE.exec(trimmed)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] })
      index += 1
      continue
    }

    // 表格：当前行以 | 开头，下一行是 |---|---| 这种分隔行。
    if (trimmed.startsWith('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const header = splitTableRow(trimmed)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[index].trim()))
        index += 1
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }

    if (UL_RE.test(line)) {
      const items: string[] = []
      while (index < lines.length) {
        const match = UL_RE.exec(lines[index])
        if (!match) break
        items.push(match[1])
        index += 1
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    if (OL_RE.test(line)) {
      const items: string[] = []
      while (index < lines.length) {
        const match = OL_RE.exec(lines[index])
        if (!match) break
        items.push(match[1])
        index += 1
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    if (QUOTE_RE.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length) {
        const match = QUOTE_RE.exec(lines[index])
        if (!match) break
        quoteLines.push(match[1])
        index += 1
      }
      blocks.push({ type: 'quote', lines: quoteLines })
      continue
    }

    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' })
      index += 1
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length) {
      const current = lines[index]
      if (current.trim() === '') break
      if (
        HEADING_RE.test(current.trim()) ||
        UL_RE.test(current) ||
        OL_RE.test(current) ||
        QUOTE_RE.test(current) ||
        HR_RE.test(current) ||
        current.trim().startsWith('```') ||
        current.trim().startsWith('|')
      ) {
        break
      }
      paragraphLines.push(current)
      index += 1
    }
    if (paragraphLines.length > 0) {
      blocks.push({ type: 'paragraph', lines: paragraphLines })
    } else {
      // 兜底：避免遇到特殊字符时死循环。
      blocks.push({ type: 'paragraph', lines: [line] })
      index += 1
    }
  }

  return blocks
}

/**
 * 判断一行是不是表格的“分隔行”。
 *
 * Markdown 表格长这样：
 *   | 指标 | 值 |
 *   |---|---|
 *   | QPS | 1200 |
 *
 * 第二行 `|---|---|` 不是数据，而是告诉解析器“上面是表头”。
 * 每个单元格至少两个短横线，两端可以有冒号表示对齐。
 *
 * `cell.replace(/\s/g, '')` 去掉所有空白，避免 `| --- |` 因为空格匹配失败。
 */
function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, '')))
}

/**
 * 把一行表格拆成单元格。
 *
 * 例子：
 *   '| 指标 | 值 |' -> ['指标', '值']
 *
 * 步骤：
 * 1. 去掉首尾空白；
 * 2. 去掉最外层两个竖线；
 * 3. 按竖线 split；
 * 4. 每个单元格再去掉首尾空白。
 *
 * 注意：这个简单拆分不支持单元格里出现 `|` 的情况。
 * 当前报告表格都是普通文本，够用；遇到转义的 `\|` 会被错误拆分，属于已知限制。
 */
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/**
 * 把 Block[] 渲染成 React 节点。
 *
 * 为什么标题从 h2 开始？
 * 页面本身已经有一个 h1（应用标题），报告里的 # 如果渲染成 h1，
 * 会破坏页面标题层级。所以这里把 Markdown 的 1~4 级标题映射成 h2~h5。
 *
 * `const Tag = (...) as 'h2' | ...`：
 * 动态标签名在 JSX 里需要首字母大写，且 TypeScript 需要知道它是合法的 HTML 标签。
 * 这里用类型断言把字符串限制成 h2~h5。
 *
 * `Math.min(block.level + 1, 5)` 防止 level=4 时算出 h6 以外的值。
 */
function renderBlocks(source: string): ReactNode[] {
  return parseBlocks(source).map((block, index) => {
    switch (block.type) {
      case 'heading': {
        const Tag = (`h${Math.min(block.level + 1, 5)}`) as 'h2' | 'h3' | 'h4' | 'h5'
        return <Tag key={index}>{renderInline(block.text)}</Tag>
      }
      case 'paragraph':
        return (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {renderInline(line)}
              </span>
            ))}
          </p>
        )
      case 'ul':
        return (
          <ul key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item)}</li>
            ))}
          </ul>
        )
      case 'ol':
        return (
          <ol key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item)}</li>
            ))}
          </ol>
        )
      case 'quote':
        return (
          <blockquote key={index}>
            {block.lines.map((line, lineIndex) => (
              <p key={lineIndex}>{renderInline(line)}</p>
            ))}
          </blockquote>
        )
      case 'code':
        return (
          <pre key={index} className="markdown__code">
            <code>{block.code}</code>
          </pre>
        )
      case 'table':
        return (
          <div key={index} className="markdown__table-wrap">
            <table>
              <thead>
                <tr>
                  {block.header.map((cell, cellIndex) => (
                    <th key={cellIndex}>{renderInline(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{renderInline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      case 'hr':
        return <hr key={index} />
      default:
        return null
    }
  })
}

/**
 * 行内元素的正则。
 *
 * 只匹配三类：
 * - **加粗**
 * - `行内代码`
 * - [链接](https://...)
 *
 * 链接只允许 http/https，避免 javascript: 这类危险协议。
 * 外层的括号把整个匹配项作为一个捕获组，方便 `match[0]` 直接使用。
 *
 * `g` 表示全局匹配：一个字符串里可以找到多个行内元素。
 *
 * 警告：带 g 的正则对象有可变的 lastIndex 状态。
 * 不要把这个常量直接用于递归函数（详见 renderInline 里的说明），
 * 那里每次都会 new RegExp(INLINE_RE) 复制一份。
 */
const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g

/**
 * 把一行文本里的加粗、行内代码、链接转成 React 节点。
 *
 * 思路：
 * - 用正则找出所有“特殊片段”；
 * - 特殊片段之间的普通文本原样保留；
 * - 每个特殊片段按类型生成 <strong> / <code> / <a>。
 *
 * 例子：
 *   '状态：**失败**，详见 `ev-1`'
 *   -> ['状态：', <strong>失败</strong>, '，详见 ', <code>ev-1</code>]
 *
 * 注意 `INLINE_RE.lastIndex = 0`：
 * 带 g 的正则会在多次 exec 之间记住 lastIndex，
 * 如果不清零，第二次调用可能从上次结束的位置开始，漏掉开头的匹配。
 */
function renderInline(text: string): ReactNode[] {
  /*
    重要：这里必须复制一份正则，不能直接复用模块级的 INLINE_RE。

    为什么？带 `g` 标志的正则对象会把“下次从哪里继续”记在 lastIndex 上，
    这个状态属于正则对象本身，不属于某一次调用。
    renderInline 是递归的（加粗文本内部还要继续解析行内元素）：
    外层匹配到 `**慢日志**` 后调用自身解析“慢日志”；
    递归里执行 `INLINE_RE.lastIndex = 0`，把外层正在使用的进度也清零了。
    递归返回后，外层下一次 exec 又从 0 开始，再次匹配同一个 `**...**`，
    于是无限递归/死循环，整个页面卡死。

    `new RegExp(INLINE_RE)` 会复制 source 和 flags，
    每次调用拥有独立的 lastIndex，递归之间互不影响。
    这也解释了为什么“正则加 g + 递归 + 共享对象”是很容易踩的坑。
  */
  const pattern = new RegExp(INLINE_RE)
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let index = 0

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    const token = match[0]
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(<strong key={`strong-${index}`}>{renderInline(token.slice(2, -2))}</strong>)
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(<code key={`code-${index}`}>{token.slice(1, -1)}</code>)
    } else {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token)
      if (link) {
        nodes.push(
          <a key={`link-${index}`} href={link[2]} target="_blank" rel="noreferrer noopener">
            {link[1]}
          </a>,
        )
      } else {
        nodes.push(token)
      }
    }
    lastIndex = match.index + token.length
    index += 1
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

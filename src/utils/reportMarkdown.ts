/**
 * ============================================================================
 * 报告 Markdown 分节与结论解析
 * ============================================================================
 *
 * 后端返回的最终报告是一整段 Markdown。产品要求页面“先展示结论，再展示修复建议，
 * 其余证据、调查过程、限制说明默认折叠”。如果直接把整段 Markdown 交给渲染器，
 * 视觉上仍然是从头读到尾，用户第一眼看到的可能是“现象”或“调查过程”，
 * 而不是最关键的结论。
 *
 * 这个文件做两件事：
 * 1. 按二级标题（`## 标题`）把 Markdown 切成章节；
 * 2. 从“## 结论”的正文里识别 `**最可能根因：**` 这类粗体字段。
 *
 * 重要原则：这里只做“展示整理”，不改写报告事实。
 * - 找不到 `## 结论` 时，页面会明确提示格式不完整，不会把候选原因伪装成确定根因；
 * - 解析失败时保留原始 Markdown，页面底部始终可以展开完整原文。
 *
 * 为什么单独放在 utils：
 * - 这些都是纯函数，不依赖 React，容易阅读，也方便以后单独写单元测试；
 * - `ReportPanel` 只负责排版，数据切分逻辑集中在这里，不会越写越乱。
 */

/**
 * 报告里的一个二级章节。
 *
 * 例子：
 *   {
 *     title: '结论',
 *     content: '**最可能根因：** ...\n\n**置信度：** 中'
 *   }
 *
 * `content` 不包含 `## 结论` 这一行，只包含标题下面的正文。
 * 这样组件把内容交给 Markdown 渲染器时，不会重复出现“结论”标题。
 */
export interface ReportSection {
  title: string
  content: string
}

/**
 * `parseReportMarkdown` 的返回值。
 *
 * `preamble` 是第一个 `##` 标题之前的内容，通常是一级标题和说明文字。
 * 如果报告没有二级标题，整份正文都会放进 `preamble`，`sections` 为空。
 */
export interface ParsedReport {
  preamble: string
  sections: ReportSection[]
}

/**
 * 章节在页面里的角色。
 *
 * 用“角色”而不是直接按标题字符串判断，好处是：
 * - “## 一、结论”和“## 结论”会被归一成同一个角色；
 * - 组件只关心“这是结论还是建议”，不用到处写字符串比较。
 *
 * `other` 是保底角色：不认识的新章节不会被丢掉，会原样放进折叠区。
 */
export type ReportSectionRole =
  | 'conclusion'
  | 'fix'
  | 'evidence'
  | 'excluded'
  | 'process'
  | 'verification'
  | 'limitations'
  | 'phenomenon'
  | 'candidates'
  | 'other'

/**
 * 按角色整理后的章节集合。
 *
 * 每个已知角色只保留“第一个匹配到的章节”；重复的同名章节会放进 `others`。
 * 为什么不直接合并？因为重复标题通常意味着报告结构有问题，
 * 保留在“其它章节”里让用户能看到原文，比悄悄丢掉更安全。
 */
export interface OrganizedReportSections {
  conclusion: ReportSection | null
  fix: ReportSection | null
  evidence: ReportSection | null
  excluded: ReportSection | null
  process: ReportSection | null
  verification: ReportSection | null
  limitations: ReportSection | null
  phenomenon: ReportSection | null
  candidates: ReportSection | null
  others: ReportSection[]
}

/**
 * 从结论正文里识别出来的一段“粗体标签 + 内容”。
 *
 * 例子：
 *   原始行：`**最可能根因：** 慢 SQL 的访问路径缺少索引`
 *   解析后：{ label: '最可能根因', body: '慢 SQL 的访问路径缺少索引' }
 *
 * `body` 会继续收集后面的行，直到遇到下一个粗体标签。
 * 所以“现象”下面的项目符号列表会完整保留在 `body` 里。
 */
export interface LabeledBlock {
  label: string
  body: string
}

/**
 * “## 结论”章节解析后的页面视图。
 *
 * 这些字段不是后端直接返回的结构化数据，而是从 Markdown 里识别出来的。
 * 因此每个字段都允许为空字符串，组件必须能在缺字段时正常显示。
 */
export interface ConclusionSectionView {
  /** 逻辑说明类的开头文字（如果结论正文在第一个粗体标签之前还有内容）。 */
  intro: string
  /** 最可能根因；如果报告没有写标签，就退回整段开头文字。 */
  rootCause: string
  /** 根因字段的原始标签，例如“最可能根因”。 */
  rootCauseLabel: string
  /** 置信度原文，例如“中”“低”“高”。 */
  confidence: string
  /** “直接证据”原文，通常包含 `ev-000001` 这样的证据编号。 */
  evidenceText: string
  /** “结论边界”原文，说明结论在哪些前提下成立、还有哪些没验证。 */
  boundary: string
  /** “现象”原文，通常是项目符号列表。 */
  phenomenon: string
  /** 证据不足时列出的候选原因，最多由报告自己控制数量。 */
  candidates: string[]
  /** 没被识别成已知字段的粗体段落，放进“结论补充”折叠区。 */
  extraBlocks: LabeledBlock[]
  /** 是否至少识别到一个粗体标签。false 表示这可能是一段普通文字。 */
  hasLabels: boolean
}

/** 匹配 `## 标题`；只认二级标题，`###` 不会命中。 */
const H2_HEADING_RE = /^##\s+(.+?)\s*$/

/** 匹配 `**标签：** 内容`，冒号在粗体里面。 */
const LABEL_INSIDE_BOLD_RE = /^\*\*([^*]+?)[：:]\*\*\s*(.*)$/

/** 匹配 `**标签**: 内容`，冒号在粗体外面。 */
const LABEL_OUTSIDE_BOLD_RE = /^\*\*([^*]+?)\*\*\s*[：:]\s*(.*)$/

/**
 * 把整份 Markdown 切成“前言 + 若干二级章节”。
 *
 * 这里按行扫描，而不是用正则一次性匹配全文，原因有两个：
 * 1. 代码块里可能出现 `## 这不是标题`，必须跳过；
 * 2. 一行一行处理时，遇到标题就知道要结束上一节，逻辑更直观。
 *
 * 小例子：
 *   输入：
 *     # 报告
 *     说明文字
 *     ## 结论
 *     根因内容
 *     ## 修复建议
 *     建议内容
 *
 *   输出：
 *     preamble = '# 报告\n说明文字'
 *     sections = [
 *       { title: '结论', content: '根因内容' },
 *       { title: '修复建议', content: '建议内容' }
 *     ]
 */
export function parseReportMarkdown(markdown: string): ParsedReport {
  // 先把 Windows 的 \r\n 和旧 Mac 的 \r 统一成 \n，后面只需要处理一种换行。
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')

  const preambleLines: string[] = []
  const sections: ReportSection[] = []

  // 当前正在收集的章节。null 表示还没遇到第一个二级标题。
  let currentTitle: string | null = null
  let currentLines: string[] = []

  // 代码块开关。Markdown 渲染器把 ``` 开头的行当成代码块边界，
  // 这里必须用同样的规则，否则代码块里的 `##` 会被误认成章节标题。
  let inCodeFence = false

  /**
   * 把当前章节保存进 sections，并清空临时缓冲。
   *
   * 这个函数在“遇到下一个标题”和“文件读完”时都会调用。
   * 抽成小函数可以避免两处写重复的 push 逻辑。
   */
  const flushCurrentSection = () => {
    if (currentTitle === null) return

    sections.push({
      title: currentTitle,
      content: currentLines.join('\n').trim(),
    })
    currentLines = []
  }

  for (const line of lines) {
    const trimmed = line.trim()

    // 只有 ``` 会切换代码块状态；和本项目 Markdown 渲染器支持的范围保持一致。
    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence
    }

    // 代码块里的 ## 是普通文字，不当作章节标题。
    const heading = inCodeFence ? null : H2_HEADING_RE.exec(line)

    if (heading) {
      flushCurrentSection()
      currentTitle = heading[1].trim()
      continue
    }

    if (currentTitle === null) {
      preambleLines.push(line)
    } else {
      currentLines.push(line)
    }
  }

  // 文件最后没有“下一个标题”触发保存，所以循环结束后要手动收尾。
  flushCurrentSection()

  return {
    preamble: preambleLines.join('\n').trim(),
    sections,
  }
}

/**
 * 去掉标题前面的编号，方便做角色判断。
 *
 * 例子：
 *   '一、结论'          -> '结论'
 *   '1. 调查过程'       -> '调查过程'
 *   '5、修复建议（未执行）' -> '修复建议（未执行）'
 *   '结论'              -> '结论'
 *
 * 注意：这个函数只用于“判断这是哪一类章节”，不会被拿去替换页面标题。
 * 页面上仍显示报告原来的标题，避免丢掉作者写的补充说明。
 */
function normalizeSectionTitle(title: string): string {
  return title
    .replace(/^\s*[一二三四五六七八九十百千]+[、.．]\s*/, '')
    .replace(/^\s*\d+(?:\.\d+)*[、.．)]?\s*/, '')
    .replace(/[：:]\s*$/, '')
    .replace(/\s+/g, '')
}

/**
 * 判断一个章节标题属于哪种角色。
 *
 * 判断顺序有讲究：
 * - “已排除与待验证”必须排在“验证”前面，否则会被误判成验证方法；
 * - “候选原因”排在“证据”之前没有冲突，但放在前面读起来更符合排查逻辑；
 * - 不认识的标题统一返回 `other`，由页面放进折叠区，绝不丢弃。
 *
 * 这里的匹配故意宽松一点，因为模型可能写成“## 5. 建议（仅建议，未执行）”。
 * 宽松匹配只影响排版，不影响报告内容本身。
 */
export function classifyReportSection(title: string): ReportSectionRole {
  const text = normalizeSectionTitle(title)

  // “已排除与待验证”里也包含“验证”两个字，所以必须先判断。
  if (text.includes('排除') || text.includes('待验证') || text.includes('未验证')) {
    return 'excluded'
  }

  if (text.includes('调查过程') || text.includes('排查过程') || text.includes('处理过程')) {
    return 'process'
  }

  if (
    text.includes('修复建议') ||
    text.includes('修复方案') ||
    text.includes('解决方案') ||
    text === '建议' ||
    text.startsWith('建议')
  ) {
    return 'fix'
  }

  if (text.includes('候选原因') || text.includes('候选根因')) {
    return 'candidates'
  }

  if (text.includes('证据')) {
    return 'evidence'
  }

  if (text === '结论' || text.endsWith('结论')) {
    return 'conclusion'
  }

  if (text.includes('验证') || text.includes('复现')) {
    return 'verification'
  }

  if (text.includes('限制') || text.includes('不确定')) {
    return 'limitations'
  }

  if (text.includes('现象') || text === '问题') {
    return 'phenomenon'
  }

  return 'other'
}

/**
 * 把章节按角色装进固定字段，组件就不用自己遍历和判断了。
 *
 * 例子：
 *   sections = [
 *     { title: '结论', content: '...' },
 *     { title: '修复建议', content: '...' },
 *     { title: '附录', content: '...' }
 *   ]
 *
 *   organized.conclusion -> 第一个章节
 *   organized.fix        -> 第二个章节
 *   organized.others     -> [{ title: '附录', ... }]
 */
export function organizeReportSections(sections: ReportSection[]): OrganizedReportSections {
  /**
   * 用 Record 明确列出“已知角色 -> 章节或 null”的映射。
   *
   * `Exclude<ReportSectionRole, 'other'>` 是 TypeScript 的工具类型：
   * 从联合类型里去掉 'other'，剩下的键都必须出现在这个对象里。
   * 这样以后新增角色时，编译器会提醒我们补字段，而不是悄悄漏掉。
   */
  const buckets: Record<Exclude<ReportSectionRole, 'other'>, ReportSection | null> = {
    conclusion: null,
    fix: null,
    evidence: null,
    excluded: null,
    process: null,
    verification: null,
    limitations: null,
    phenomenon: null,
    candidates: null,
  }

  const others: ReportSection[] = []

  for (const section of sections) {
    const role = classifyReportSection(section.title)

    if (role === 'other') {
      others.push(section)
      continue
    }

    // 同一个角色只收第一个章节；重复的章节放回 others，页面仍然能看到。
    if (buckets[role] === null) {
      buckets[role] = section
    } else {
      others.push(section)
    }
  }

  // 展开运算符把 buckets 的字段原样合并进返回值，再补上 others。
  return { ...buckets, others }
}

/**
 * 去掉前言里的一级标题。
 *
 * 报告通常以 `# 慢 SQL 调查报告` 开头，但页面面板本身已经有“最终报告”标题，
 * 再显示一次会重复。这里只去掉第一行的一级标题，后面的说明文字（比如
 * “> 环境说明：本轮为模拟数据”）会保留。
 *
 * 例子：
 *   '# 报告\n> 模拟数据说明' -> '> 模拟数据说明'
 *   '普通说明'               -> '普通说明'
 */
export function stripLeadingHeading(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')

  // 标题前面可能有空行，先跳过。
  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift()
  }

  if (lines.length > 0 && /^#\s+/.test(lines[0])) {
    lines.shift()
  }

  return lines.join('\n').trim()
}

/**
 * 匹配一行粗体标签。
 *
 * Markdown 里可能写成两种形式：
 *   **最可能根因：** 内容   （冒号在粗体里面）
 *   **最可能根因**: 内容    （冒号在粗体外面）
 *
 * 返回 null 表示这一行不是粗体标签，只是普通正文。
 */
function matchBoldLabel(line: string): { label: string; rest: string } | null {
  const inside = LABEL_INSIDE_BOLD_RE.exec(line)
  if (inside) {
    return { label: inside[1].trim(), rest: inside[2].trim() }
  }

  const outside = LABEL_OUTSIDE_BOLD_RE.exec(line)
  if (outside) {
    return { label: outside[1].trim(), rest: outside[2].trim() }
  }

  return null
}

/**
 * 把结论正文拆成“开头文字 + 若干粗体标签块”。
 *
 * 例子：
 *   **最可能根因：** 缺少联合索引
 *   **置信度：** 中
 *   **现象：**
 *   - 查询变慢
 *
 * 输出：
 *   intro = ''
 *   blocks = [
 *     { label: '最可能根因', body: '缺少联合索引' },
 *     { label: '置信度', body: '中' },
 *     { label: '现象', body: '- 查询变慢' }
 *   ]
 *
 * 标签后面的内容会一直收集到下一个标签为止，所以多行列表不会丢。
 */
function parseLabeledBlocks(content: string): { intro: string; blocks: LabeledBlock[] } {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const introLines: string[] = []
  const blocks: LabeledBlock[] = []

  let current: { label: string; lines: string[] } | null = null
  let inCodeFence = false

  const flushCurrent = () => {
    if (current === null) return

    blocks.push({
      label: current.label,
      body: current.lines.join('\n').trim(),
    })
    current = null
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence
    }

    // 代码块里的 `**xxx：**` 只是示例文本，不应该当成结论字段。
    const labelMatch = inCodeFence ? null : matchBoldLabel(trimmed)

    if (labelMatch) {
      flushCurrent()
      current = {
        label: labelMatch.label,
        lines: labelMatch.rest ? [labelMatch.rest] : [],
      }
      continue
    }

    if (current === null) {
      introLines.push(line)
    } else {
      current.lines.push(line)
    }
  }

  flushCurrent()

  return {
    intro: introLines.join('\n').trim(),
    blocks,
  }
}

/**
 * 把候选原因块拆成一条条可展示的列表项。
 *
 * 报告里的候选原因通常是：
 *   1. **[有观测支持]** 全表扫描
 *   2. **[未验证]** 资源瓶颈
 *
 * 这里去掉行首的 `1.` / `-` 等列表标记，因为页面会用 `<ol>` 自己编号，
 * 保留原编号会出现“1. 1. ...”这种重复。
 *
 * 如果某一条候选原因换行写了补充说明，后续普通行会拼回上一条，
 * 不会把一句完整的话拆成多条。
 */
function splitCandidateItems(body: string): string[] {
  const items: string[] = []

  for (const rawLine of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const numbered = /^\d+[.)]\s+(.*)$/.exec(line)
    if (numbered) {
      items.push(numbered[1])
      continue
    }

    const bulleted = /^[-*+]\s+(.*)$/.exec(line)
    if (bulleted) {
      items.push(bulleted[1])
      continue
    }

    // 普通文字：如果前面已经有候选，就当作上一条的补充说明。
    if (items.length > 0) {
      items[items.length - 1] = `${items[items.length - 1]}\n${line}`
    } else {
      items.push(line)
    }
  }

  return items
}

/**
 * 解析“## 结论”章节。
 *
 * 报告约定写法：
 *   **最可能根因：** ...
 *   **置信度：** 中
 *   **直接证据：** `ev-000001`、`ev-000002`
 *   **结论边界：** ...
 *   **现象：**
 *   - ...
 *
 * 但模型不一定完全遵守格式，所以这里做“尽量解析 + 保底”：
 * - 找到“最可能根因”就单独突出显示；
 * - 找不到任何粗体标签，就把整段正文当作结论正文；
 * - 不认识的标签放进 `extraBlocks`，页面用“结论补充”折叠区展示，不丢内容。
 */
export function parseConclusionSection(content: string): ConclusionSectionView {
  const { intro, blocks } = parseLabeledBlocks(content)

  /**
   * 用过的块要记下来，最后放进 extraBlocks 时要排除它们，
   * 否则“最可能根因”会既显示在顶部，又重复显示在“结论补充”里。
   *
   * Set 存的是对象引用：同一个 block 对象只会被标记一次。
   */
  const usedBlocks = new Set<LabeledBlock>()

  /**
   * 按标签正则找第一个尚未使用的块，并标记为已使用。
   *
   * 例子：
   *   pickBlock(/置信度|把握/) -> { label: '置信度', body: '中' }
   *
   * 返回 undefined 表示报告没写这个字段。
   */
  const pickBlock = (pattern: RegExp): LabeledBlock | undefined => {
    const block = blocks.find((item) => !usedBlocks.has(item) && pattern.test(item.label))
    if (block) usedBlocks.add(block)
    return block
  }

  // 先挑边界、置信度、证据、现象、候选这些“专用字段”，
  // 最后再挑根因，避免“结论边界”被根因的 `/结论/` 规则抢走。
  const boundaryBlock = pickBlock(/边界|前提|适用范围/)
  const confidenceBlock = pickBlock(/置信度|把握/)
  const evidenceBlock = pickBlock(/直接证据|支撑证据|证据/)
  const phenomenonBlock = pickBlock(/现象|问题描述/)
  const candidateBlock = pickBlock(/候选/)

  // 根因标签可能写成“最可能根因”“主要根因”“诊断结论”，都尽量接住。
  const rootCauseBlock = pickBlock(/最可能根因|主要根因|根因|诊断|结论/)

  /**
   * 没被任何字段消费的块，保留下来给“结论补充”。
   *
   * 例如模型多写了 `**影响范围：** ...`，页面不应该丢掉它。
   */
  const extraBlocks = blocks.filter((block) => !usedBlocks.has(block))

  // 如果第一个标签之前还有说明文字，也放进补充区；但如果它就是根因正文，就不重复。
  if (intro && rootCauseBlock) {
    extraBlocks.unshift({ label: '结论说明', body: intro })
  }

  return {
    intro,
    rootCause: rootCauseBlock?.body || intro,
    rootCauseLabel: rootCauseBlock?.label || '结论',
    confidence: confidenceBlock?.body.split('\n')[0]?.trim() ?? '',
    evidenceText: evidenceBlock?.body ?? '',
    boundary: boundaryBlock?.body ?? '',
    phenomenon: phenomenonBlock?.body ?? '',
    candidates: candidateBlock ? splitCandidateItems(candidateBlock.body) : [],
    extraBlocks,
    hasLabels: blocks.length > 0,
  }
}

/**
 * 从一段文字里收集证据编号。
 *
 * 报告里的证据编号形如 `ev-000001`，可能带反引号、中文顿号或括号。
 * 这里只提取编号本身，页面再用按钮展示，点击就能打开证据抽屉。
 *
 * 例子：
 *   '证据：`ev-000001`、`ev-000002`' -> ['ev-000001', 'ev-000002']
 *   '没有引用'                        -> []
 *
 * 用 Set 去重：同一段话里重复提到同一个证据时，只显示一个按钮。
 */
export function extractEvidenceRefs(...texts: string[]): string[] {
  const refs = new Set<string>()

  for (const text of texts) {
    // 每次调用都新建正则，避免全局正则的 lastIndex 在多次调用间残留。
    const matches = text.matchAll(/\bev-[A-Za-z0-9_-]+\b/g)
    for (const match of matches) {
      refs.add(match[0])
    }
  }

  return [...refs]
}

/**
 * 去掉行内 Markdown 标记，得到适合放进徽标/按钮的纯文本。
 *
 * 例子：
 *   '**中**'        -> '中'
 *   '`ev-000001`'   -> 'ev-000001'
 *   '[报告](url)'   -> '报告'
 *
 * 页面只在“置信度徽标”这种很短的位置使用它，不用于正文。
 * 正文仍然交给 Markdown 渲染器，保留加粗、代码和链接。
 */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

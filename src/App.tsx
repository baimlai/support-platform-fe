/**
 * ============================================================================
 * 应用主页面
 * ============================================================================
 *
 * 页面结构：
 * - 顶部栏：应用名、API 地址；
 * - 左侧：工单输入 + 能力目录；
 * - 右侧：运行概览、时间线/轮次详情、Topic、报告、证据、原始事件；
 * - 证据预览使用覆盖式抽屉。
 *
 * 数据来源：
 * - 任务、事件、Topic、报告、证据全部来自后端接口；
 * - 前端不生成任何“示例执行结果”；
 * - 任务 ID 会写入 URL，刷新页面后可以恢复同一个任务。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, apiBaseLabel } from './api/client'
import type {
  CapabilitiesView,
  CreateTaskInput,
  ModelsView,
  SampleView,
} from './api/types'
import { useTask } from './api/useTask'
import { CapabilitiesBar } from './components/CapabilitiesBar'
import { EmptyState } from './components/EmptyState'
import { EventLog } from './components/EventLog'
import { EvidenceDrawer } from './components/EvidenceDrawer'
import { EvidencePanel } from './components/EvidencePanel'
import { ReportPanel } from './components/ReportPanel'
import { RunHeader } from './components/RunHeader'
import { TicketForm } from './components/TicketForm'
import { Timeline } from './components/Timeline'
import { TopicPanel } from './components/TopicPanel'
import { TopBar } from './components/TopBar'
import { TurnDetail } from './components/TurnDetail'
import { WelcomePanel } from './components/WelcomePanel'
import { classNames } from './utils/format'

/**
 * 工作区标签。
 *
 * 这里用“字符串字面量联合类型”而不是普通 string：
 * - 写成 'timeline' | 'topic' | ... 后，activeTab 只能是这五个值之一；
 * - 如果打错成 'timeilne'，编译器会立刻报错；
 * - 编辑器还能自动补全。
 */
type TabKey = 'timeline' | 'topic' | 'report' | 'evidence' | 'events'

/**
 * 标签配置数组。
 *
 * `Array<{ key: TabKey; label: string }>` 是泛型写法，
 * 等价于 `{ key: TabKey; label: string }[]`，都表示“对象数组”。
 * 显式标注的好处：以后往数组里加一项时，key 写错会被编译器发现。
 */
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'timeline', label: '运行时间线' },
  { key: 'topic', label: 'Topic' },
  { key: 'report', label: '报告' },
  { key: 'evidence', label: '证据' },
  { key: 'events', label: '事件流' },
]

/**
 * 从 URL 读取任务 ID，支持刷新后恢复。
 *
 * `URLSearchParams` 是浏览器内置的查询参数解析器：
 *   ?task_id=abc -> get('task_id') 得到 'abc'
 * 没有这个参数时 get 返回 null。
 *
 * `value?.trim() || null`：
 * - value 为 null 时，`?.` 让整个表达式直接得到 undefined，不会报错；
 * - trim 后如果是空字符串，`||` 会继续走到 null。
 * 最终返回 `string | null`，和 useState 的类型对得上。
 */
function readTaskIdFromUrl(): string | null {
  const value = new URLSearchParams(window.location.search).get('task_id')
  return value?.trim() || null
}

/**
 * 把任务 ID 写回 URL。
 *
 * 用 replaceState 而不是 pushState：创建任务不应该产生一条“可以后退”的历史记录，
 * 否则用户点浏览器后退会回到旧任务，容易误解。
 */
function writeTaskIdToUrl(taskId: string | null): void {
  const url = new URL(window.location.href)
  if (taskId) {
    url.searchParams.set('task_id', taskId)
  } else {
    url.searchParams.delete('task_id')
  }
  window.history.replaceState(null, '', url)
}

/** 把 unknown 异常转成可展示的字符串。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function App() {
  /**
   * 初始值用函数形式 `useState(() => ...)`：
   * 这样只在首次渲染时读一次 URL，后续重新渲染不会反复读取。
   *
   * 如果写成 `useState(readTaskIdFromUrl())`，虽然结果一样，
   * 但每次渲染都会先执行一次函数，读 URL 是白做的。
   *
   * 下面这些 state 可以按用途分组理解：
   * - 页面导航：taskId / selectedTurn / activeTab / evidenceId；
   * - 样例请求：samples / loading / error / reloadKey；
   * - 能力目录请求：capabilities / loading / error / reloadKey；
   * - 创建任务：creating / createError。
   *
   * 每一组都用“数据 + 加载中 + 错误”三件套，页面才能区分
   * “还没回来”“失败了”“确实为空”三种状态。
   */
  const [taskId, setTaskId] = useState<string | null>(() => readTaskIdFromUrl())
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('timeline')
  const [evidenceId, setEvidenceId] = useState<string | null>(null)

  const [samples, setSamples] = useState<SampleView[]>([])
  const [samplesLoading, setSamplesLoading] = useState(false)
  const [samplesError, setSamplesError] = useState<string | null>(null)
  const [samplesReloadKey, setSamplesReloadKey] = useState(0)

  const [capabilities, setCapabilities] = useState<CapabilitiesView | null>(null)
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false)
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null)
  const [capabilitiesReloadKey, setCapabilitiesReloadKey] = useState(0)

  /*
    模型列表单独一组状态。
    为什么不直接只读 capabilities.models？
    - /api/models 是专门接口，语义最直接；
    - capabilities 里也带了一份模型列表，可以作为兜底；
    - 两边都失败时，表单仍然允许创建任务，只是不带模型字段，由后端用默认模型。
  */
  const [models, setModels] = useState<ModelsView | null>(null)
  /*
    初始值给 true，而不是 false。
    useEffect 要等首次渲染结束后才执行；如果这里从 false 开始，
    表单会先闪一下“后端未返回模型列表”，再变成“正在读取”，属于误导。
    直接从 true 开始，第一次渲染就显示“正在读取可用模型…”。
  */
  const [modelsLoading, setModelsLoading] = useState(true)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [modelsReloadKey, setModelsReloadKey] = useState(0)

  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  /**
   * useTask 负责轮询和派生数据。
   * taskId 为 null 时它不会发请求。
   *
   * `loading: taskLoading` 是解构重命名：
   * Hook 返回的字段叫 loading，但页面里还有 samplesLoading、
   * capabilitiesLoading，重命名后一眼能看出这个 loading 属于任务轮询。
   */
  const {
    task,
    events,
    turns,
    topic,
    report,
    loading: taskLoading,
    polling,
    error: taskError,
    cancelling,
    cancel,
    refresh,
  } = useTask(taskId)

  /** 载入样例。依赖 samplesReloadKey，点“刷新”时重新请求。 */
  useEffect(() => {
    const controller = new AbortController()
    let disposed = false

    setSamplesLoading(true)
    setSamplesError(null)

    api
      .listSamples(controller.signal)
      .then((list) => {
        if (disposed) return
        setSamples(list)
        setSamplesLoading(false)
      })
      .catch((err: unknown) => {
        if (disposed || controller.signal.aborted) return
        setSamplesLoading(false)
        setSamplesError(errorText(err))
      })

    return () => {
      disposed = true
      controller.abort()
    }
  }, [samplesReloadKey])

  /** 载入能力目录。和样例一样，支持手动刷新。 */
  useEffect(() => {
    const controller = new AbortController()
    let disposed = false

    setCapabilitiesLoading(true)
    setCapabilitiesError(null)

    api
      .getCapabilities(controller.signal)
      .then((result) => {
        if (disposed) return
        setCapabilities(result)
        setCapabilitiesLoading(false)
      })
      .catch((err: unknown) => {
        if (disposed || controller.signal.aborted) return
        setCapabilitiesLoading(false)
        setCapabilitiesError(errorText(err))
      })

    return () => {
      disposed = true
      controller.abort()
    }
  }, [capabilitiesReloadKey])

  /**
   * 载入模型列表。
   *
   * 和样例、能力目录一样：数据 + 加载中 + 错误 + 重试 key。
   * 即使这个请求失败，页面也不会阻塞创建任务，只是下拉框不可用，
   * 提交时不带模型字段，由后端使用默认模型。
   */
  useEffect(() => {
    const controller = new AbortController()
    let disposed = false

    setModelsLoading(true)
    setModelsError(null)

    api
      .getModels(controller.signal)
      .then((result) => {
        if (disposed) return
        setModels(result)
        setModelsLoading(false)
      })
      .catch((err: unknown) => {
        if (disposed || controller.signal.aborted) return
        setModelsLoading(false)
        setModelsError(errorText(err))
      })

    return () => {
      disposed = true
      controller.abort()
    }
  }, [modelsReloadKey])

  /**
   * 实际用于渲染下拉框的模型列表。
   *
   * 优先级：
   * 1. 独立接口 /api/models 的结果；
   * 2. 能力目录里的 capabilities.models（后端也会返回同一份数据）；
   * 3. 都没有 -> null，表单显示“将使用服务端默认模型”。
   *
   * 这里没有用 useMemo：只是两个变量做 `??`，计算成本可以忽略；
   * 强行包一层 useMemo 反而让代码更难读。
   */
  const effectiveModels = models ?? capabilities?.models ?? null

  /** /api/models 还在加载，且暂时没有兜底数据时，表单显示“正在读取”。 */
  const effectiveModelsLoading = modelsLoading || (models === null && capabilitiesLoading)

  /**
   * 只有“独立接口失败”且“能力目录也没有模型数据”时，才把错误显示给用户。
   * 如果能力目录已经兜底成功，错误就不重要，避免吓到用户。
   */
  const effectiveModelsError =
    models === null && capabilities?.models == null ? modelsError : null

  /**
   * 自动选中最新轮次。
   *
   * 规则：
   * - 还没有选中，或选中的轮次已经不存在 -> 选中最后一轮；
   * - 用户手动选了旧轮次 -> 保持用户选择，不强行跳回最新。
   *
   * 这样任务运行时可以看到最新进展，用户回看历史时也不会被“抢焦点”。
   */
  useEffect(() => {
    if (turns.length === 0) return

    const stillExists = selectedTurn !== null && turns.some((turn) => turn.turn === selectedTurn)
    if (!stillExists) {
      setSelectedTurn(turns[turns.length - 1].turn)
    }
  }, [turns, selectedTurn])

  /** 当前选中的轮次对象；没有选中时为 null。 */
  const selectedTurnView = useMemo(
    () => turns.find((turn) => turn.turn === selectedTurn) ?? null,
    [turns, selectedTurn],
  )

  const handleCreate = useCallback(async (input: CreateTaskInput) => {
    setCreating(true)
    setCreateError(null)

    try {
      const created = await api.createTask(input)

      // 新任务：重置页面状态，并把任务 ID 写入 URL。
      setTaskId(created.task_id)
      writeTaskIdToUrl(created.task_id)
      setSelectedTurn(null)
      setEvidenceId(null)
      setActiveTab('timeline')
    } catch (err) {
      setCreateError(errorText(err))
    } finally {
      setCreating(false)
    }
  }, [])

  const handleOpenEvidence = useCallback((id: string) => {
    setEvidenceId(id)
  }, [])

  const handleCloseEvidence = useCallback(() => {
    setEvidenceId(null)
  }, [])

  /**
   * 标签上的小圆点表示“已有可用数据”：
   * - Topic：后端返回了 topic；
   * - 报告：报告已经生成。
   * 这不是“未读”提示，只是一个存在性标记。
   */
  /*
    `Record<TabKey, boolean>` 要求这个对象必须把五个 key 都写全，
    少写一个（例如漏了 events）编译就会报错。
    这比 `{ [key: string]: boolean }` 更严格，也更适合标签这种固定集合。
  */
  const tabHasDot: Record<TabKey, boolean> = {
    timeline: false,
    topic: topic !== null,
    report: report !== null,
    evidence: false,
    events: false,
  }

  return (
    <div className="app">
      <TopBar apiLabel={apiBaseLabel} />

      <main className="app__main">
        <aside className="app__sidebar">
          <TicketForm
            samples={samples}
            samplesLoading={samplesLoading}
            samplesError={samplesError}
            onReloadSamples={() => setSamplesReloadKey((key) => key + 1)}
            models={effectiveModels}
            modelsLoading={effectiveModelsLoading}
            modelsError={effectiveModelsError}
            onReloadModels={() => setModelsReloadKey((key) => key + 1)}
            onCreate={handleCreate}
            creating={creating}
            createError={createError}
          />

          <CapabilitiesBar
            capabilities={capabilities}
            loading={capabilitiesLoading}
            error={capabilitiesError}
            onRetry={() => setCapabilitiesReloadKey((key) => key + 1)}
          />
        </aside>

        <div className="app__workspace">
          {!taskId ? (
            <WelcomePanel />
          ) : (
            <>
              <RunHeader
                taskId={taskId}
                task={task}
                models={effectiveModels}
                loading={taskLoading}
                polling={polling}
                error={taskError}
                cancelling={cancelling}
                onCancel={cancel}
                onRefresh={refresh}
              />

              <nav className="tabs" role="tablist" aria-label="工作区">
                {TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.key}
                    className={classNames('tabs__item', activeTab === tab.key && 'tabs__item--active')}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    {tab.label}
                    {tabHasDot[tab.key] ? <span className="tabs__dot" aria-label="已有数据" /> : null}
                  </button>
                ))}
              </nav>

              <div className="app__tab-panel" role="tabpanel">
                {activeTab === 'timeline' ? (
                  <div className="timeline-layout">
                    <Timeline
                      turns={turns}
                      selectedTurn={selectedTurn}
                      onSelectTurn={setSelectedTurn}
                      polling={polling}
                    />
                    <TurnDetail
                      taskId={taskId}
                      turn={selectedTurnView}
                      onOpenEvidence={handleOpenEvidence}
                    />
                  </div>
                ) : null}

                {activeTab === 'topic' ? (
                  <TopicPanel topic={topic} onOpenEvidence={handleOpenEvidence} />
                ) : null}

                {activeTab === 'report' ? (
                  <ReportPanel
                    report={report}
                    /*
                      `task?.status ?? null` 分两步：
                      1. task 可能还没加载，`?.` 先保证不报错，得到 undefined；
                      2. `?? null` 把 undefined 统一成 null，
                         让 ReportPanel 的参数类型 `string | null` 保持简单。
                    */
                    taskStatus={task?.status ?? null}
                    onOpenEvidence={handleOpenEvidence}
                  />
                ) : null}

                {activeTab === 'evidence' ? (
                  <EvidencePanel taskId={taskId} onOpenEvidence={handleOpenEvidence} />
                ) : null}

                {activeTab === 'events' ? <EventLog events={events} /> : null}

                {!task && taskError ? (
                  <EmptyState
                    title="无法读取任务"
                    description="请确认后端已启动、任务 ID 正确，或点击上方刷新重试。"
                    action={
                      <button type="button" className="button button--ghost" onClick={refresh}>
                        重试
                      </button>
                    }
                  />
                ) : null}
              </div>
            </>
          )}
        </div>
      </main>

      {/*
        证据抽屉覆盖整个页面。
        key={evidenceId} 保证切换到另一条证据时组件重新挂载，offset 回到 0，
        不会把上一条证据的页码带到下一条。
      */}
      {taskId && evidenceId ? (
        <EvidenceDrawer
          key={evidenceId}
          taskId={taskId}
          evidenceId={evidenceId}
          onClose={handleCloseEvidence}
        />
      ) : null}
    </div>
  )
}

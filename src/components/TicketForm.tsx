/**
 * ============================================================================
 * 工单输入表单
 * ============================================================================
 *
 * 支持两种输入方式：
 * 1. 选择后端提供的模拟样例（sample_id）；
 * 2. 手工输入工单正文（ticket_text）。
 *
 * 两种方式不会同时提交：用户选“样例”就传 sample_id，选“手工输入”就传 ticket_text。
 * tenant_id 是可选字段，两种方式都可以带。
 *
 * 重要约定：样例列表来自后端 /api/samples，前端不硬编码任何工单内容。
 * 后端没返回样例时显示空状态，并允许用户切到手工输入，而不是塞一个假样例。
 *
 * 交互约定：
 * - 输入框是受控组件，值统一由组件 state 管理；
 * - 提交时只发送当前模式对应的字段；
 * - 创建失败的错误由父组件传入，本地校验错误单独显示。
 */

import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type {
  CreateTaskInput,
  ModelProviderView,
  ModelsView,
  SampleView,
} from '../api/types'
import { EmptyState, Notice } from './EmptyState'
import { PlayIcon, RefreshIcon } from './icons'
import { classNames } from '../utils/format'

/** 两种输入模式。 */
type FormMode = 'sample' | 'manual'

/**
 * 选出一个 provider 应该默认使用哪个模型。
 *
 * 正常情况直接用后端给的 default_model；
 * 如果 default_model 不在 models 列表里（后端数据不一致），
 * 就退回列表第一个，保证下拉框一定有一个可选项。
 *
 * 参数类型写 `ModelProviderView` 而不是 `any`：
 * 这样函数内部访问 provider.models / provider.default_model 时，
 * 编辑器和编译器都知道这两个字段一定存在。
 */
function defaultModelFor(provider: ModelProviderView): string {
  if (provider.models.includes(provider.default_model)) return provider.default_model
  return provider.models[0] ?? provider.default_model
}

/**
 * 数据库类型 -> 展示名。
 *
 * 为什么不在 JSX 里写一长串三元表达式：
 * 类型会继续增加，集中放一张映射表更容易维护；未知类型就原样显示，
 * 不会因为是新数据库（例如 TiDB）就显示空白。
 */
const DATABASE_TYPE_LABELS: Record<string, string> = {
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  redis: 'Redis',
  mongodb: 'MongoDB',
  elasticsearch: 'Elasticsearch',
  clickhouse: 'ClickHouse',
}

function formatDatabaseType(value: string): string {
  return DATABASE_TYPE_LABELS[value.toLowerCase()] ?? value
}

interface TicketFormProps {
  /** 后端返回的样例列表。 */
  samples: SampleView[]
  samplesLoading: boolean
  samplesError: string | null
  /** 重新拉取样例。 */
  onReloadSamples: () => void
  /** 后端返回的可用模型列表；还没加载或加载失败时为 null。 */
  models: ModelsView | null
  modelsLoading: boolean
  modelsError: string | null
  /** 重新拉取模型列表。 */
  onReloadModels: () => void
  /** 提交创建任务；父组件负责调用后端。 */
  onCreate: (input: CreateTaskInput) => void | Promise<void>
  /** 是否正在创建任务。 */
  creating: boolean
  /** 创建任务失败时的错误消息。 */
  createError: string | null
}

export function TicketForm({
  samples,
  samplesLoading,
  samplesError,
  onReloadSamples,
  models,
  modelsLoading,
  modelsError,
  onReloadModels,
  onCreate,
  creating,
  createError,
}: TicketFormProps) {
  const [mode, setMode] = useState<FormMode>('sample')
  const [selectedSampleId, setSelectedSampleId] = useState('')
  const [manualText, setManualText] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  /*
    模型下拉框的受控状态。
    - modelProvider 是 provider 标识，例如 mock / deepseek；
    - modelName 是具体模型名，例如 mock-dba / deepseek-flash。
    两个值最终会作为 model_provider / model_name 提交给后端。
  */
  const [modelProvider, setModelProvider] = useState('')
  const [modelName, setModelName] = useState('')

  /**
   * 样例列表变化时，确保 selectedSampleId 指向一个真实存在的样例。
   *
   * 场景：
   * - 页面刚打开，样例从后端加载完成 -> 默认选中第一个；
   * - 后端刷新后第一个样例被删了 -> 自动切到新的第一个；
   * - 列表为空 -> 清空选择。
   *
   * 依赖数组 [samples, selectedSampleId]：
   * 只要样例列表或当前选择变了，就重新检查。
   */
  useEffect(() => {
    if (samples.length === 0) {
      setSelectedSampleId('')
      return
    }

    const stillExists = samples.some((sample) => sample.id === selectedSampleId)
    if (!stillExists) setSelectedSampleId(samples[0].id)
  }, [samples, selectedSampleId])

  /**
   * 当前选中的样例对象。
   *
   * `find` 找不到时返回 undefined，所以类型是 `SampleView | undefined`。
   * 模板里用 `selectedSample?.text` 安全访问。
   */
  const selectedSample = samples.find((sample) => sample.id === selectedSampleId)

  /**
   * 模型列表变化时，保证“提供方 + 模型”始终是一组合法值。
   *
   * 触发场景：
   * - 页面刚打开，/api/models 返回 -> 自动选中 default_provider；
   * - 用户切换 provider -> 自动带出该 provider 的 default_model；
   * - 后端刷新后某个 provider 变成不可用 -> 自动切到其它可用 provider；
   * - 所有 provider 都不可用 -> 两个值清空，提交时给出明确提示。
   *
   * 为什么把 modelProvider / modelName 都放进依赖数组？
   * 因为用户手动改下拉框后，这个 effect 需要重新检查“新组合是否合法”。
   * 只要组合已经合法，effect 内部不会再 setState，所以不会无限循环。
   */
  useEffect(() => {
    if (!models || models.providers.length === 0) {
      setModelProvider('')
      setModelName('')
      return
    }

    const current = models.providers.find((item) => item.provider === modelProvider)

    // 当前 provider 仍然可用：只需要确认 modelName 还在它的模型列表里。
    if (current?.available) {
      if (!current.models.includes(modelName)) {
        setModelName(defaultModelFor(current))
      }
      return
    }

    /*
      当前 provider 不存在或已不可用，按以下顺序找替代：
      1. 服务端默认 provider，且当前可用；
      2. 任意一个可用 provider；
      3. 都没有 -> null（下拉框显示“请选择”，提交会被拦截）。
    */
    const fallback =
      models.providers.find(
        (item) => item.provider === models.default_provider && item.available,
      ) ??
      models.providers.find((item) => item.available) ??
      null

    setModelProvider(fallback?.provider ?? '')
    setModelName(fallback ? defaultModelFor(fallback) : '')
  }, [models, modelProvider, modelName])

  /** 当前选中的模型提供方对象；模型列表还没加载时为 undefined。 */
  const selectedProvider = models?.providers.find((item) => item.provider === modelProvider)

  /** 所有不可用的提供方，用来在表单里展示原因。 */
  const unavailableProviders = models?.providers.filter((item) => !item.available) ?? []

  /**
   * 是否需要用户明确选择模型。
   *
   * - 模型列表加载失败 / 后端没返回列表：不需要，提交时不带模型字段，走服务端默认；
   * - 有列表：必须选中一个可用 provider，并且 modelName 在该 provider 的模型列表里。
   *
   * `selectedProvider.models.includes(modelName)` 同时挡住了三种异常：
   * 没选 provider、provider 不可用、modelName 是旧值或空字符串。
   */
  const modelSelectionRequired = models !== null && models.providers.length > 0
  const modelSelectionValid =
    !modelSelectionRequired ||
    (selectedProvider?.available === true && selectedProvider.models.includes(modelName))

  const handleModeChange = (nextMode: FormMode) => {
    setMode(nextMode)
    setLocalError(null)
  }

  const handleSampleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedSampleId(event.target.value)
    setLocalError(null)
  }

  /**
   * 切换模型提供方。
   *
   * 关键动作：把 modelName 重置为新 provider 的默认模型。
   * 否则会出现“provider 是 deepseek、model 还是 mock-dba”的非法组合。
   */
  const handleProviderChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextProvider = event.target.value
    const providerView = models?.providers.find((item) => item.provider === nextProvider)

    setModelProvider(nextProvider)
    setModelName(providerView ? defaultModelFor(providerView) : '')
    setLocalError(null)
  }

  const handleModelChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setModelName(event.target.value)
    setLocalError(null)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    // 阻止浏览器默认的表单提交行为（刷新页面）。
    event.preventDefault()
    setLocalError(null)

    // 模型列表已经加载，但当前组合不合法（例如所有 provider 都不可用）时，不提交。
    if (!modelSelectionValid) {
      setLocalError('当前没有可用的模型来源，请等待后端配置完成，或点击“刷新”重试')
      return
    }

    /*
      Pick<CreateTaskInput, 'model_provider' | 'model_name'> 是 TS 内置的工具类型：
      它从 CreateTaskInput 里只挑出这两个字段，得到一个更小的类型：
        { model_provider?: string; model_name?: string }

      为什么先建一个空对象再按条件赋值？
      - 模型列表加载失败时，两个字段都不应该出现在请求体里；
      - 后端约定“不传 = 用默认模型”，传空字符串反而可能触发 422。
      这样写比 `{ model_provider: modelProvider || undefined }` 更清楚。
    */
    const modelFields: Pick<CreateTaskInput, 'model_provider' | 'model_name'> = {}
    if (modelProvider && modelName) {
      modelFields.model_provider = modelProvider
      modelFields.model_name = modelName
    }

    if (mode === 'sample') {
      if (!selectedSampleId) {
        setLocalError('请先选择一个样例工单')
        return
      }
      void onCreate({ sample_id: selectedSampleId, tenant_id: tenantId, ...modelFields })
      return
    }

    const text = manualText.trim()
    if (!text) {
      setLocalError('请填写工单内容')
      return
    }
    void onCreate({ ticket_text: text, tenant_id: tenantId, ...modelFields })
  }

  return (
    <section className="panel ticket-form">
      <div className="panel__header">
        <div>
          <div className="panel__eyebrow">输入</div>
          <h2 className="panel__title">提交工单</h2>
        </div>
      </div>

      {/* 模式切换：两个按钮，当前模式用 aria-pressed 标记，方便读屏软件识别。 */}
      <div className="segmented" role="group" aria-label="工单输入方式">
        <button
          type="button"
          className={classNames('segmented__item', mode === 'sample' && 'segmented__item--active')}
          aria-pressed={mode === 'sample'}
          onClick={() => handleModeChange('sample')}
        >
          样例工单
        </button>
        <button
          type="button"
          className={classNames('segmented__item', mode === 'manual' && 'segmented__item--active')}
          aria-pressed={mode === 'manual'}
          onClick={() => handleModeChange('manual')}
        >
          手工输入
        </button>
      </div>

      <form onSubmit={handleSubmit} className="ticket-form__form">
        {mode === 'sample' ? (
          <div className="field">
            <div className="field__label-row">
              <label className="field__label" htmlFor="sample-select">
                样例
              </label>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={onReloadSamples}
                disabled={samplesLoading}
              >
                <RefreshIcon size={14} />
                {samplesLoading ? '加载中' : '刷新'}
              </button>
            </div>

            {samples.length > 0 ? (
              <>
                <select
                  id="sample-select"
                  className="input"
                  value={selectedSampleId}
                  onChange={handleSampleChange}
                >
                  {samples.map((sample) => (
                    <option key={sample.id} value={sample.id}>
                      {sample.databaseType
                        ? `[${formatDatabaseType(sample.databaseType)}] `
                        : ''}
                      {sample.label}
                      {sample.mock ? '（模拟）' : ''}
                    </option>
                  ))}
                </select>

                {selectedSample ? (
                  <div className="sample-preview">
                    <div className="sample-preview__meta">
                      {/* mock 是后端标记；页面必须明确写“模拟”，避免用户误以为是真实工单。 */}
                      {selectedSample.mock ? <span className="tag tag--mock">模拟样例</span> : null}
                      {selectedSample.databaseType ? (
                        <span className="tag tag--accent">
                          {formatDatabaseType(selectedSample.databaseType)}
                        </span>
                      ) : null}
                      {selectedSample.scenarioLabel ? (
                        <span className="tag tag--scenario">{selectedSample.scenarioLabel}</span>
                      ) : null}
                      {selectedSample.skill ? (
                        <span className="tag tag--muted">Skill {selectedSample.skill}</span>
                      ) : null}
                      {selectedSample.instanceId ? (
                        <span className="tag">实例 {selectedSample.instanceId}</span>
                      ) : null}
                      <span className="tag tag--muted">ID {selectedSample.id}</span>
                    </div>
                    <pre className="sample-preview__text">{selectedSample.text}</pre>
                  </div>
                ) : null}
              </>
            ) : (
              <EmptyState
                title={samplesLoading ? '正在加载样例…' : '后端未提供样例'}
                description={
                  samplesLoading
                    ? '正在请求 /api/samples。'
                    : '可以切换到“手工输入”直接粘贴工单内容，或点击刷新重试。'
                }
                action={
                  <button type="button" className="button button--ghost" onClick={onReloadSamples}>
                    <RefreshIcon size={14} />
                    重新加载
                  </button>
                }
              />
            )}

            {/* 样例接口报错时，保留上面的空状态，同时把具体错误显示出来。 */}
            {samplesError ? <Notice tone="error">样例加载失败：{samplesError}</Notice> : null}
          </div>
        ) : (
          <div className="field">
            <label className="field__label" htmlFor="ticket-text">
              工单内容
            </label>
            <textarea
              id="ticket-text"
              className="input input--textarea"
              value={manualText}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                setManualText(event.target.value)
                setLocalError(null)
              }}
              placeholder={'例如：\n业务反馈订单列表页在 10:00 左右变慢，查询涉及 order 表，请协助排查慢 SQL。'}
              rows={9}
            />
            <div className="field__hint">
              尽量包含：发生时间、涉及表/实例、现象（超时/锁等待/QPS 下降）、已做过的操作。
            </div>
          </div>
        )}

        <div className="field">
          <label className="field__label" htmlFor="tenant-id">
            租户标识 <span className="field__optional">可选</span>
          </label>
          <input
            id="tenant-id"
            className="input"
            value={tenantId}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setTenantId(event.target.value)}
            placeholder="例如 tenant-a"
            autoComplete="off"
          />
          <div className="field__hint">后端如果支持多租户，会用这个值限定排查范围。</div>
        </div>

        {/*
          模型选择区。
          数据全部来自后端 /api/models（或 capabilities.models）：
          - 提供方不可用时 option 置灰，并把 reason 显示在下方；
          - 切换提供方会自动带出该提供方的默认模型；
          - 高级用户可以在“模型”下拉框里选同提供方的其它模型。
        */}
        <div className="field">
          <div className="field__label-row">
            <span className="field__label">模型来源</span>
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={onReloadModels}
              disabled={modelsLoading}
            >
              <RefreshIcon size={14} />
              {modelsLoading ? '加载中' : '刷新'}
            </button>
          </div>

          {models && models.providers.length > 0 ? (
            <>
              <div className="model-picker">
                <div className="field">
                  <label className="field__label" htmlFor="model-provider">
                    提供方
                  </label>
                  <select
                    id="model-provider"
                    className="input"
                    value={modelProvider}
                    onChange={handleProviderChange}
                    disabled={creating}
                  >
                    {/*
                      第一项是占位：所有 provider 都不可用时，modelProvider 会是空字符串。
                      option 的 disabled 只是“不能选”，placeholder 本身还会正常显示。
                    */}
                    <option value="" disabled>
                      请选择模型来源
                    </option>
                    {models.providers.map((provider) => (
                      <option
                        key={provider.provider}
                        value={provider.provider}
                        // 不可用的项直接置灰，用户无法选中，避免提交后才知道没配置 Key。
                        disabled={!provider.available}
                      >
                        {provider.label ?? provider.provider}
                        {provider.provider === models.default_provider ? '（默认）' : ''}
                        {provider.available ? '' : '（不可用）'}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="model-name">
                    模型
                  </label>
                  <select
                    id="model-name"
                    className="input"
                    value={modelName}
                    onChange={handleModelChange}
                    disabled={
                      creating ||
                      selectedProvider?.available !== true ||
                      (selectedProvider?.models.length ?? 0) === 0
                    }
                  >
                    {(selectedProvider?.models ?? []).length === 0 ? (
                      <option value="">无可用模型</option>
                    ) : null}
                    {(selectedProvider?.models ?? []).map((name) => (
                      <option key={name} value={name}>
                        {name}
                        {name === selectedProvider?.default_model ? '（默认）' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/*
                说明和不可用原因都放在下拉框下方。
                只把原因塞进 option 的 title 里不够明显：用户不展开下拉框就看不到。
              */}
              {selectedProvider?.description ? (
                <div className="field__hint">{selectedProvider.description}</div>
              ) : null}

              {unavailableProviders.length > 0 ? (
                <div className="field__hint">
                  不可用：
                  {unavailableProviders
                    .map(
                      (provider) =>
                        `${provider.label ?? provider.provider}（${provider.reason ?? '原因未提供'}）`,
                    )
                    .join('；')}
                </div>
              ) : null}

              <div className="field__hint">
                模型信息会写入任务快照；历史任务始终显示当时使用的模型，不会跟随这里的选择变化。
              </div>
            </>
          ) : modelsLoading ? (
            <div className="field__hint">正在读取可用模型…</div>
          ) : modelsError ? (
            /*
              模型接口失败不阻塞创建任务。
              提交时不带 model_provider / model_name，后端会使用服务端默认模型。
            */
            <Notice tone="warning">
              模型列表加载失败：{modelsError}。创建任务时将使用服务端默认模型。
            </Notice>
          ) : (
            <div className="field__hint">
              后端未返回模型列表，创建任务时将使用服务端默认模型。
            </div>
          )}
        </div>

        {localError ? <Notice tone="warning">{localError}</Notice> : null}
        {createError ? <Notice tone="error">{createError}</Notice> : null}

        <button type="submit" className="button button--primary button--block" disabled={creating}>
          <PlayIcon size={16} />
          {creating ? '正在创建任务…' : '开始诊断'}
        </button>

        <p className="ticket-form__footnote">
          点击后会调用后端 <code>POST /api/tasks</code>，随后页面按事件流展示真实执行过程。
        </p>
      </form>
    </section>
  )
}

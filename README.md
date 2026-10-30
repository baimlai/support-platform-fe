# DBA 工单调查工作台（前端）

这是 DBA 工单 Agent 小平台的前端仓库，使用 React + Vite + TypeScript 实现。

页面上的任务、事件、轮次、工具调用、Topic、报告、证据全部来自后端 HTTP 接口。前端不内置任何“示例执行结果”；后端没返回的数据就显示空状态或“未返回”，不会伪造一条看起来像真的运行记录。

后端样例覆盖 10 个场景、6 种数据库：MySQL、PostgreSQL、Redis、MongoDB、
Elasticsearch、ClickHouse。前端不硬编码场景内容，只使用 `/api/samples` 返回的
`database_type`、`scenario_label`、`skill` 等字段做展示；执行时后端会按工单
自动选择对应的 Skill 和模拟数据集。

## 环境要求

- Node.js 20+（本仓库开发时使用 Node 26）
- pnpm 11+

## 本地启动

```bash
# 1. 安装依赖
pnpm install

# 2. 配置后端地址（可选）
cp .env.example .env
# 默认通过 Vite 代理把 /api 转发到 http://127.0.0.1:8000
# 后端不在这个地址时，修改 VITE_API_PROXY_TARGET

# 3. 启动开发服务器
pnpm dev
```

打开 http://localhost:5173 。

如果后端接口暂时没启动，页面不会白屏：

- 样例列表、能力目录显示请求失败提示，并提供“重试”；
- 创建任务会显示具体错误；
- 已有任务读取失败时会显示错误和重试按钮。

## 常用命令

```bash
pnpm dev        # 开发服务器，默认 5173 端口
pnpm typecheck  # TypeScript 类型检查
pnpm build      # 类型检查 + 生产构建，输出到 dist/
pnpm preview    # 本地预览生产构建
```

## 后端接口

后端契约 v0（实际字段以后端实现为准，前端集中在适配层兼容）：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/samples` | 样例工单列表 |
| POST | `/api/tasks` | 创建任务 |
| GET | `/api/tasks/{task_id}` | 任务详情 |
| GET | `/api/tasks/{task_id}/events?after_seq=0&limit=200` | 增量事件 |
| GET | `/api/tasks/{task_id}/turns/{turn}/context` | 某一轮的模型上下文 |
| GET | `/api/tasks/{task_id}/report` | 最终报告 |
| POST | `/api/tasks/{task_id}/cancel` | 取消任务 |
| GET | `/api/tasks/{task_id}/evidence` | 证据列表 |
| GET | `/api/tasks/{task_id}/evidence/{evidence_id}?offset=0&limit=4000` | 证据片段 |
| GET | `/api/capabilities` | 能力目录（Skill／工具／模型列表） |
| GET | `/api/models` | 可用模型提供方与默认模型 |

联调细节和当前进度见 [`outputs/前端进度与联调接口.md`](outputs/前端进度与联调接口.md)。

## 页面怎么拿到数据

### 轮询而不是 SSE

页面每 1.5 秒请求一次任务详情和增量事件；任务进入终态（completed / failed / cancelled / interrupted 等）或事件里出现 `agent_end` 后停止轮询。网络错误时 3 秒后重试。后端已经提供 SSE，但页面当前仍用轮询；以后要切换时，只需要替换 `src/api/useTask.ts` 里的传输层，页面组件不用改。

### 模型选择

新建任务时可以选择模型提供方（mock / DeepSeek）和具体模型。列表来自 `GET /api/models`，请求失败时复用 `capabilities.models`；不可用的提供方会置灰并显示原因。

任务详情里的“本次模型”只读任务快照中的 `model_provider` / `model_name`，不会用当前表单选择去回填历史任务。前端不保存任何模型密钥。

### 多数据库样例展示

`GET /api/samples` 的每个样例可以带：

- `database_type`：MySQL / PostgreSQL / Redis / MongoDB / Elasticsearch / ClickHouse；
- `scenario_label`：场景中文标题；
- `skill`：该样例使用的 Skill，例如 `slow-sql` 或 `dba-triage`；
- `symptom`：工单现象摘要；
- `scenario_order`：后端排序值，前端按返回顺序展示，不重新排序。

`normalizeSamples()` 把这些字段转成 `SampleView.databaseType` / `scenarioLabel` /
`skill` 等可选属性。样例下拉框显示 `[数据库] 标题`，预览区显示数据库、场景标题、
Skill、实例和 ID 标签。任务创建只传 `sample_id`，Skill 由后端按工单决定，
避免前端猜错数据库或 Skill。

### 轮次由事件归并

后端只提供事件流和 `current_turn`，不直接提供 turns 数组。前端在 `src/api/normalize.ts` 的 `deriveTurns()` 里按 `turn` 字段把事件归并成轮次：

- `turn_start` / `turn_end` 决定轮次边界和状态；
- `model_request` / `model_response` 记录模型是否响应、回复正文和停止原因；
- `message_update` / `message_end` 补充流式消息；
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` 按 `tool_call_id` 合并成一条工具调用。

这样刷新页面后只靠持久化事件就能恢复时间线。

### 证据有界预览

证据正文可能很大，所以证据抽屉按 `offset/limit` 分段读取，单次最多 4000 字符。页面只持有当前片段，不会把整个大文件塞进浏览器。

### 报告结论优先

报告接口只返回 Markdown（`structured` 固定为 `null`），页面不能假设后端有独立的结论字段。
`src/utils/reportMarkdown.ts` 按 `##` 标题切章节，并解析 `## 结论` 里的粗体标签：

- `**最可能根因：**`、`**置信度：**`、`**直接证据：**`、`**结论边界：**`
  放在第一屏主卡片；
- `## 修复建议` 紧随其后，首选方案和备选方案都在这里；
- `## 已排除与待验证`、`## 证据链`、`## 调查过程`、`## 验证方法`、
  `## 当前限制` 用原生 `<details>` 折叠，默认收起；
- 报告没有 `## 结论` 时，显示“报告未按标准给出单独结论”，原样展示候选原因或现象，
  **不会把候选原因提升成已确认根因**；
- 不认识的章节归入“其它章节”；完整 Markdown 和原始 JSON 仍保留在折叠区，避免丢内容。

后端章节和标签的完整约定见后端仓库 `outputs/进度与联调.md` 5.9 节。

### 刷新不取消任务

任务 ID 会写入 URL 的 `?task_id=`。刷新页面会重新拉取同一个任务，不会调用取消接口。

## 目录结构

```text
src/
├── api/
│   ├── client.ts        # fetch 封装、ApiError、各接口函数
│   ├── types.ts         # 后端契约类型 + 页面模型
│   ├── normalize.ts     # 原始 JSON -> 页面模型；事件归并出轮次
│   ├── useTask.ts       # 任务轮询、取消、报告读取
│   └── useTurnContext.ts# 按需读取某一轮上下文
├── components/
│   ├── TopBar.tsx           # 顶部栏
│   ├── TicketForm.tsx       # 样例选择 / 手工输入工单
│   ├── CapabilitiesBar.tsx  # 后端能力目录
│   ├── WelcomePanel.tsx     # 未创建任务时的说明
│   ├── RunHeader.tsx        # 任务状态、刷新、取消
│   ├── Timeline.tsx         # 轮次时间线
│   ├── TurnDetail.tsx       # 选中轮次的详情
│   ├── ToolCallCard.tsx     # 工具调用卡片
│   ├── TopicPanel.tsx       # Topic / 事实 / 候选原因
│   ├── ReportPanel.tsx      # 最终报告
│   ├── EvidencePanel.tsx    # 证据列表
│   ├── EvidenceDrawer.tsx   # 证据分段预览
│   ├── EventLog.tsx         # 原始事件流
│   ├── Markdown.tsx         # 安全的最小 Markdown 渲染
│   ├── EmptyState.tsx       # 空状态 / 提示
│   ├── StatusBadge.tsx      # 状态标签
│   └── icons.tsx            # 内联 SVG 图标
├── utils/format.ts      # 时间、耗时、数字、复制等纯展示工具
├── utils/reportMarkdown.ts # 报告章节切分、结论标签解析、证据编号提取
├── App.tsx              # 页面状态与布局
├── main.tsx             # React 入口
└── styles.css           # 设计变量、布局、组件样式、深色模式
```

数据字段的兼容逻辑集中在 `src/api/normalize.ts`。后端字段名变化时优先改这里，不要把 `raw.tool_name ?? raw.toolName` 这类判断散落到组件里。

## 显示约定

- 后端没返回的轮次、工具、证据、报告显示空状态，不补假数据；
- 工具状态区分 `ok / no_data / error / timeout / blocked / cancelled / invalid_arguments`，不能把失败显示成“没有异常”；
- 报告缺失时区分“任务还在跑，稍后生成”和“任务已结束但后端没返回”；
- 能力目录只代表后端注册了哪些 Skill／工具，不代表本轮实际调用过，实际调用以事件流为准。

## 安全与凭据

前端不保存、不读取任何模型 API Key。所有模型调用都发生在后端。

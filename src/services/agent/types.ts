import type { JsonSchema } from '../api/types.js'

/** 工具来源：决定图标、审批策略与不可用时的提示 */
export type ToolSource = 'browser' | 'desktop' | 'extension' | 'mcp'

/** 风险等级：safe 只读，write 改本地数据，exec 执行代码，network 出网 */
export type ToolRisk = 'safe' | 'write' | 'exec' | 'network'

/** 注册到模型的工具定义 */
export type ToolDefinition = {
  /** 协议内唯一名；第三方工具会加来源前缀，避免重名 */
  name: string
  /** 展示用短名，缺省等于 name */
  label: string
  description: string
  inputSchema: JsonSchema
  source: ToolSource
  /** MCP 服务器 id 或桌面端标识 */
  serverId?: string
  serverName?: string
  risk: ToolRisk
  /** 默认按 risk 决定，个别工具可覆盖 */
  requiresApproval?: boolean
  /** 图标键，缺省按 source 取 */
  icon?: string
  /** 覆盖默认超时；传 Infinity 表示一直等待（例如等待用户回答） */
  timeoutMs?: number
}

export type ToolCallStatus =
  /** 模型已声明调用，等待执行队列 */
  | 'pending'
  /** 等待用户审批 */
  | 'awaiting'
  /** 正在执行 */
  | 'running'
  | 'done'
  | 'error'
  /** 用户拒绝 */
  | 'denied'

export type ArtifactKind =
  | 'markdown'
  | 'text'
  | 'html'
  | 'widget'
  | 'json'
  | 'csv'
  | 'code'
  | 'image'
  | 'binary'

/** 文件产物元数据；正文另存 IndexedDB，消息里只保留索引 */
export type ArtifactMeta = {
  id: string
  name: string
  mime: string
  size: number
  kind: ArtifactKind
  createdAt: number
  source: ToolSource
  /** 产出它的工具名 */
  tool?: string
}

/** 工具产出的内联图片，base64 回传给模型并可直接在界面渲染 */
export type ToolImage = {
  mediaType: string
  /** 不带 data: 前缀的 base64 */
  data: string
  name?: string
}

/** 工具执行结果：content 回传模型，artifacts/meta 只用于界面，images 会进入上下文 */
export type ToolResult = {
  content: string
  isError?: boolean
  artifacts?: ArtifactMeta[]
  meta?: Record<string, unknown>
  images?: ToolImage[]
}

/** 工具执行上下文 */
export type ToolContext = {
  sessionId: string
  signal: AbortSignal
  /** 运行中反馈，展示在工具卡片上 */
  progress: (text: string) => void
}

export type ToolExecutor = (
  input: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult>

/** 注册表条目：定义 + 执行函数 */
export type RegisteredTool = {
  definition: ToolDefinition
  execute: ToolExecutor
}

/** 审批请求 */
export type ApprovalRequest = {
  id: string
  sessionId: string
  toolName: string
  label: string
  source: ToolSource
  risk: ToolRisk
  input: unknown
  description: string
}

export type ApprovalDecision = 'allow_once' | 'allow_session' | 'deny'

/** 按风险给出默认审批策略 */
export const needsApproval = (tool: Pick<ToolDefinition, 'risk' | 'requiresApproval'>) =>
  tool.requiresApproval ?? (tool.risk === 'write' || tool.risk === 'exec')

export const sourceLabel = (source: ToolSource): string => {
  switch (source) {
    case 'browser':
      return '浏览器'
    case 'desktop':
      return '桌面端'
    case 'extension':
      return '扩展'
    case 'mcp':
      return 'MCP'
  }
}

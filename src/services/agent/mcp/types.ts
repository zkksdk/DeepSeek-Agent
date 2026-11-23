export type McpTransport = 'http' | 'sse' | 'stdio'

export type McpServerConfig = {
  id: string
  name: string
  transport: McpTransport
  /** http / sse 必填 */
  url?: string
  headers?: Record<string, string>
  /** stdio 由桌面端托管 */
  command?: string
  args?: string[]
  env?: Record<string, string>
  enabled: boolean
}

export type McpToolInfo = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** 服务器声明的行为提示，用于决定是否需要审批 */
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean }
  /** 经桌面端桥接的 stdio 服务器名，远程服务器由客户端自行附上 */
  server?: string
}

export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string; blob?: string } }

export type McpCallResult = {
  content: McpContent[]
  isError?: boolean
}

export type McpServerState = {
  status: 'idle' | 'connecting' | 'ready' | 'error'
  error?: string
  tools: McpToolInfo[]
  serverName?: string
  version?: string
}

/**
 * 浏览器端 MCP（Model Context Protocol）客户端：通过 HTTP / SSE 传输连接
 * 远程 MCP 服务器，拉取工具并转发调用。不依赖 Node，也不需要后端。
 *
 * 支持的传输：Streamable HTTP（POST JSON-RPC，响应可为 JSON 或 text/event-stream）。
 * 注意：服务器需允许浏览器跨域访问（CORS），否则连接会失败。
 */
import type { ClientToolDefinition } from '../api/types.js'
import { storage } from '../platform/storage.js'

export type McpServer = {
  id: string
  name: string
  url: string
  enabled: boolean
  /** 可选自定义请求头，如鉴权 */
  headers?: Record<string, string>
}

export type McpTool = {
  serverId: string
  /** MCP 服务器上的原始工具名 */
  originalName: string
  /** 发给模型使用的工具名（带前缀，保证唯一） */
  exposedName: string
  definition: ClientToolDefinition
}

const SERVERS_KEY = 'chat-demo:mcp-servers'
const CLIENT_INFO = { name: 'chat-demo', version: '0.1.3' }
const PROTOCOL_VERSION = '2025-03-26'
const REQUEST_TIMEOUT = 20000

/** 已建立的会话缓存：serverId -> { sessionId, tools } */
const sessions = new Map<string, { sessionId: string | null; tools: McpTool[] }>()

let rpcSeq = 0
const nextId = () => ++rpcSeq

export const readMcpServers = (): McpServer[] => {
  const raw = storage.getJSON<unknown>(SERVERS_KEY, [])
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter(
    (item): item is McpServer =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as McpServer).id === 'string' &&
      typeof (item as McpServer).name === 'string' &&
      typeof (item as McpServer).url === 'string'
  )
}

export const saveMcpServers = (servers: McpServer[]) => {
  storage.setJSON(SERVERS_KEY, servers)
}

export const addMcpServer = (name: string, url: string, enabled = true): McpServer | null => {
  const trimmedName = name.trim()
  const trimmedUrl = url.trim()
  if (!trimmedName || !/^https?:\/\//i.test(trimmedUrl)) {
    return null
  }
  const server: McpServer = {
    id: `mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: trimmedName.slice(0, 40),
    url: trimmedUrl,
    enabled,
  }
  const servers = [...readMcpServers(), server]
  saveMcpServers(servers)
  return server
}

export const removeMcpServer = (id: string) => {
  saveMcpServers(readMcpServers().filter((server) => server.id !== id))
  sessions.delete(id)
}

export const setMcpServerEnabled = (id: string, enabled: boolean) => {
  saveMcpServers(
    readMcpServers().map((server) => (server.id === id ? { ...server, enabled } : server))
  )
}

/** 读取 SSE 流里第一条匹配 id 的 JSON-RPC 响应 */
const readSseResponse = async (response: Response, id: number): Promise<unknown> => {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('响应不可读')
  }
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []
  const deadline = Date.now() + REQUEST_TIMEOUT
  while (Date.now() < deadline) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      buffer = buffer.slice(newline + 1)
      if (line === '') {
        if (dataLines.length > 0) {
          const payload = dataLines.join('\n')
          dataLines = []
          try {
            const parsed = JSON.parse(payload) as { id?: number }
            if (parsed.id === undefined || parsed.id === id) {
              await reader.cancel().catch(() => undefined)
              return parsed
            }
          } catch {
            // 忽略非 JSON 心跳
          }
        }
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
      newline = buffer.indexOf('\n')
    }
  }
  await reader.cancel().catch(() => undefined)
  throw new Error('未收到 MCP 响应（超时）')
}

type RpcOptions = {
  sessionId?: string | null
  headers?: Record<string, string>
  signal?: AbortSignal
}

/** 一次 JSON-RPC 调用（POST），兼容 JSON 与 SSE 响应 */
const rpc = async (
  server: McpServer,
  method: string,
  params: unknown,
  options: RpcOptions = {}
): Promise<unknown> => {
  const id = nextId()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  const signal = options.signal ?? controller.signal
  try {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(options.sessionId ? { 'Mcp-Session-Id': options.sessionId } : {}),
        ...server.headers,
        ...options.headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal,
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('text/event-stream')) {
      const message = (await readSseResponse(response, id)) as {
        result?: unknown
        error?: { message?: string }
      }
      if (message.error) {
        throw new Error(message.error.message ?? 'MCP 调用失败')
      }
      return message.result
    }
    const body = (await response.json()) as { result?: unknown; error?: { message?: string } }
    if (body.error) {
      throw new Error(body.error.message ?? 'MCP 调用失败')
    }
    return body.result
  } finally {
    clearTimeout(timer)
  }
}

const notify = async (server: McpServer, method: string, sessionId: string | null) => {
  try {
    await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
        ...server.headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method }),
    })
  } catch {
    // 通知失败不影响后续
  }
}

/** 生成对模型安全的工具名：仅字母数字下划线，<=64 */
const exposedNameFor = (server: McpServer, toolName: string): string => {
  const safe = `${server.name}_${toolName}`.replace(/[^a-zA-Z0-9_-]/g, '_')
  return safe.slice(0, 64)
}

/** 连接 MCP 服务器并拉取工具列表 */
export const connectMcpServer = async (server: McpServer): Promise<McpTool[]> => {
  const init = (await rpc(server, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO,
  })) as { protocolVersion?: string } | undefined
  const sessionId = null
  await notify(server, 'notifications/initialized', sessionId)
  const listed = (await rpc(server, 'tools/list', {}, { sessionId })) as
    | { tools?: { name: string; description?: string; inputSchema?: unknown }[] }
    | undefined
  const tools: McpTool[] = (listed?.tools ?? []).map((tool) => ({
    serverId: server.id,
    originalName: tool.name,
    exposedName: exposedNameFor(server, tool.name),
    definition: {
      name: exposedNameFor(server, tool.name),
      description: tool.description ?? `MCP 工具 ${tool.name}`,
      input_schema:
        typeof tool.inputSchema === 'object' && tool.inputSchema !== null
          ? (tool.inputSchema as ClientToolDefinition['input_schema'])
          : { type: 'object', properties: {} },
    },
  }))
  sessions.set(server.id, { sessionId, tools })
  void init
  return tools
}

/** 获取所有启用 MCP 服务器的工具（带缓存，失败静默跳过） */
export const getMcpTools = async (): Promise<McpTool[]> => {
  const servers = readMcpServers().filter((server) => server.enabled)
  const result: McpTool[] = []
  for (const server of servers) {
    const cached = sessions.get(server.id)
    if (cached) {
      result.push(...cached.tools)
      continue
    }
    try {
      result.push(...(await connectMcpServer(server)))
    } catch {
      // 单个服务器失败不影响其他
    }
  }
  return result
}

const textFromContent = (content: unknown): string => {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item
        }
        if (typeof item === 'object' && item !== null) {
          const block = item as { type?: string; text?: string }
          if (block.type === 'text' && typeof block.text === 'string') {
            return block.text
          }
          return JSON.stringify(item)
        }
        return String(item)
      })
      .join('\n')
  }
  return content === undefined ? '' : JSON.stringify(content)
}

/** 当前会话缓存中是否包含某个对外工具名 */
export const hasMcpTool = (exposedName: string): boolean => {
  for (const cached of sessions.values()) {
    if (cached.tools.some((tool) => tool.exposedName === exposedName)) {
      return true
    }
  }
  return false
}

/** 调用 MCP 工具 */
export const callMcpTool = async (
  exposedName: string,
  input: unknown,
  signal?: AbortSignal
): Promise<{ content: string; isError: boolean }> => {
  for (const [serverId, cached] of sessions) {
    const tool = cached.tools.find((item) => item.exposedName === exposedName)
    if (!tool) {
      continue
    }
    const server = readMcpServers().find((item) => item.id === serverId)
    if (!server) {
      return { content: 'MCP 服务器已不存在', isError: true }
    }
    try {
      const result = (await rpc(
        server,
        'tools/call',
        { name: tool.originalName, arguments: input ?? {} },
        { sessionId: cached.sessionId, signal }
      )) as { content?: unknown; isError?: boolean } | undefined
      return {
        content: textFromContent(result?.content) || '（无返回内容）',
        isError: result?.isError === true,
      }
    } catch (error) {
      return {
        content: `MCP 调用失败：${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }
  }
  return { content: `未找到 MCP 工具：${exposedName}`, isError: true }
}

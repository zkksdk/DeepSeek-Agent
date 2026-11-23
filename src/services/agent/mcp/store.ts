import { create } from 'zustand'
import { createArtifact } from '../artifacts.js'
import { registerTools, unregisterTools } from '../registry.js'
import type { RegisteredTool, ToolDefinition } from '../types.js'
import { McpClient } from './client.js'
import type { McpServerConfig, McpServerState, McpToolInfo } from './types.js'

const STORAGE_KEY = 'chat-agent:mcp-servers'

type McpStore = {
  servers: McpServerConfig[]
  states: Record<string, McpServerState>
}

const readServers = (): McpServerConfig[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.flatMap((item): McpServerConfig[] => {
      if (typeof item !== 'object' || item === null) {
        return []
      }
      const record = item as Record<string, unknown>
      if (typeof record.id !== 'string' || typeof record.name !== 'string') {
        return []
      }
      const transport = record.transport
      if (transport !== 'http' && transport !== 'sse' && transport !== 'stdio') {
        return []
      }
      return [
        {
          id: record.id,
          name: record.name,
          transport,
          url: typeof record.url === 'string' ? record.url : undefined,
          headers:
            typeof record.headers === 'object' && record.headers !== null
              ? (record.headers as Record<string, string>)
              : undefined,
          command: typeof record.command === 'string' ? record.command : undefined,
          args: Array.isArray(record.args) ? record.args.filter((a): a is string => typeof a === 'string') : undefined,
          env:
            typeof record.env === 'object' && record.env !== null
              ? (record.env as Record<string, string>)
              : undefined,
          enabled: record.enabled !== false,
        },
      ]
    })
  } catch {
    return []
  }
}

const persist = (servers: McpServerConfig[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servers))
  } catch {
    // 存储不可用时仅内存生效
  }
}

const emptyState: McpServerState = { status: 'idle', tools: [] }

export const useMcp = create<McpStore>(() => ({
  servers: readServers(),
  states: {},
}))

const clients = new Map<string, McpClient>()
/** 每个服务器的工具前缀，连接期间保持稳定 */
const prefixes = new Map<string, string>()

const setState = (id: string, state: McpServerState) =>
  useMcp.setState((current) => ({ states: { ...current.states, [id]: state } }))

const slugify = (name: string, fallback: string) => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || fallback
}

const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, '_')

/** 前缀保证不同服务器之间的工具不重名，同时符合协议对工具名长度与字符的限制 */
const buildPrefix = (config: McpServerConfig) => {
  const existing = prefixes.get(config.id)
  if (existing) {
    return existing
  }
  const base = `mcp_${slugify(config.name, config.id.slice(0, 6))}`
  let prefix = base
  let index = 2
  const taken = new Set([...prefixes.values()])
  while (taken.has(prefix)) {
    prefix = `${base}_${index}`
    index += 1
  }
  prefixes.set(config.id, prefix)
  return prefix
}

const contentToResult = async (
  server: McpServerConfig,
  toolName: string,
  result: Awaited<ReturnType<McpClient['callTool']>>,
  sessionId?: string
) => {
  const texts: string[] = []
  const artifacts = []
  for (const [index, item] of result.content.entries()) {
    if (item.type === 'text') {
      texts.push(item.text)
      continue
    }
    if (item.type === 'image') {
      const artifact = await createArtifact({
        name: `${slugify(server.name, 'mcp')}-${index + 1}.png`,
        dataUrl: `data:${item.mimeType};base64,${item.data}`,
        mime: item.mimeType,
        source: 'mcp',
        tool: toolName,
        sessionId,
      })
      artifacts.push(artifact)
      texts.push(`（图片已保存为 ${artifact.name}，见对话中的文件卡片）`)
      continue
    }
    if (item.type === 'resource') {
      if (item.resource.text) {
        texts.push(item.resource.text)
      } else if (item.resource.blob) {
        const mime = item.resource.mimeType ?? 'application/octet-stream'
        const artifact = await createArtifact({
          name: `${slugify(server.name, 'mcp')}-resource-${index + 1}.bin`,
          dataUrl: `data:${mime};base64,${item.resource.blob}`,
          mime,
          source: 'mcp',
          tool: toolName,
          sessionId,
        })
        artifacts.push(artifact)
        texts.push(`（资源已保存为 ${artifact.name}）`)
      }
    }
  }
  return {
    content: texts.join('\n\n') || '（工具没有返回内容）',
    isError: result.isError,
    artifacts: artifacts.length > 0 ? artifacts : undefined,
  }
}

const registerMcpTools = (
  config: McpServerConfig,
  tools: McpToolInfo[],
  client: McpClient,
  prefix: string
) => {
  const registered: RegisteredTool[] = tools.map((tool) => {
    const exposed = `${prefix}_${sanitize(tool.name)}`.slice(0, 64)
    const readOnly = tool.annotations?.readOnlyHint === true
    const definition: ToolDefinition = {
      name: exposed,
      label: `${config.name} · ${tool.name}`,
      description:
        tool.description ||
        `MCP 服务器「${config.name}」提供的工具 ${tool.name}。`,
      inputSchema:
        typeof tool.inputSchema === 'object' && tool.inputSchema !== null
          ? {
              type: 'object',
              ...(tool.inputSchema as Record<string, unknown>),
            }
          : { type: 'object', properties: {} },
      source: 'mcp',
      serverId: config.id,
      serverName: config.name,
      risk: readOnly ? 'safe' : 'write',
      requiresApproval: !readOnly,
      icon: 'mcp',
    }
    return {
      definition,
      execute: async (input, context) => {
        if (context.signal.aborted) {
          return { content: '已停止', isError: true }
        }
        context.progress(`调用 ${tool.name}…`)
        try {
          const result = await client.callTool(tool.name, input)
          return await contentToResult(config, tool.name, result, context.sessionId)
        } catch (error) {
          return {
            content: `MCP 工具调用失败：${error instanceof Error ? error.message : String(error)}`,
            isError: true,
          }
        }
      },
    }
  })
  registerTools(registered)
}

export const connectServer = async (id: string): Promise<void> => {
  const config = useMcp.getState().servers.find((server) => server.id === id)
  if (!config) {
    return
  }
  disconnectServer(id)
  if (config.transport === 'stdio') {
    setState(id, {
      status: 'error',
      error: '本地 stdio 服务器需要由桌面端托管，请在桌面端配置后连接。',
      tools: [],
    })
    return
  }
  setState(id, { status: 'connecting', tools: [] })
  const client = new McpClient(config)
  clients.set(id, client)
  try {
    await client.connect()
    const tools = await client.listTools()
    const prefix = buildPrefix(config)
    registerMcpTools(config, tools, client, prefix)
    setState(id, {
      status: 'ready',
      tools,
      serverName: client.info.name,
      version: client.info.version,
    })
  } catch (error) {
    client.close()
    clients.delete(id)
    const message = error instanceof Error ? error.message : String(error)
    setState(id, {
      status: 'error',
      error: /Failed to fetch|NetworkError|Load failed/i.test(message)
        ? `${message}（多为跨域限制：远程 MCP 需要允许本站 Origin，或改用桌面端 stdio 代理）`
        : message,
      tools: [],
    })
  }
}

export const disconnectServer = (id: string) => {
  const client = clients.get(id)
  if (client) {
    client.close()
    clients.delete(id)
  }
  prefixes.delete(id)
  unregisterTools((definition) => definition.source === 'mcp' && definition.serverId === id)
  setState(id, emptyState)
}

export const addServer = (input: Omit<McpServerConfig, 'id' | 'enabled'> & { enabled?: boolean }) => {
  const id = `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const config: McpServerConfig = { ...input, id, enabled: input.enabled !== false }
  const servers = [...useMcp.getState().servers, config]
  useMcp.setState({ servers })
  persist(servers)
  return config
}

export const updateServer = (id: string, patch: Partial<McpServerConfig>) => {
  const servers = useMcp.getState().servers.map((server) =>
    server.id === id ? { ...server, ...patch, id } : server
  )
  useMcp.setState({ servers })
  persist(servers)
}

export const removeServer = (id: string) => {
  disconnectServer(id)
  const servers = useMcp.getState().servers.filter((server) => server.id !== id)
  useMcp.setState((current) => ({
    servers,
    states: Object.fromEntries(Object.entries(current.states).filter(([key]) => key !== id)),
  }))
  persist(servers)
}

/** 启动时连接所有启用的服务器；失败只影响自身 */
export const connectEnabledServers = async () => {
  const servers = useMcp.getState().servers.filter((server) => server.enabled)
  await Promise.allSettled(servers.map((server) => connectServer(server.id)))
}

export const getServerPrefix = (id: string) => prefixes.get(id) ?? ''

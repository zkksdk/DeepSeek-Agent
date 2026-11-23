import { create } from 'zustand'
import { createArtifact } from '../artifacts.js'
import { registerTools, unregisterTools } from '../registry.js'
import type { RegisteredTool, ToolDefinition } from '../types.js'
import { DesktopClient, type DesktopInfo } from './client.js'
import type { McpCallResult, McpToolInfo } from '../mcp/types.js'
import type { ToolImage } from '../types.js'

const URL_KEY = 'chat-agent:desktop-url'
const TOKEN_KEY = 'chat-agent:desktop-token'
const AUTO_KEY = 'chat-agent:desktop-auto'

export type DesktopStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

type DesktopStore = {
  status: DesktopStatus
  error?: string
  info?: DesktopInfo
  url: string
  token: string
  autoConnect: boolean
  toolCount: number
}

const read = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export const useDesktop = create<DesktopStore>(() => ({
  status: 'disconnected',
  url: read(URL_KEY, 'ws://127.0.0.1:8765'),
  token: read(TOKEN_KEY, ''),
  autoConnect: read(AUTO_KEY, 'false') === 'true',
  toolCount: 0,
}))

let client: DesktopClient | null = null
let reconnectTimer: number | null = null
let heartbeatTimer: number | null = null
let reconnectAttempt = 0
/** 主动建立连接后为 true；主动断开时置 false，用于区分「掉线」与「关掉」 */
let wantConnected = false

const INIT_PARAMS = {
  protocolVersion: '2024-11-05',
  clientInfo: { name: 'chat-agent', version: '1.0.0' },
}

const cancelReconnect = () => {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

const stopHeartbeat = () => {
  if (heartbeatTimer !== null) {
    window.clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

/**
 * 桌面端被强杀时，Windows 上的 TCP 可能停在半开状态，浏览器迟迟不触发 onclose。
 * 每 15 秒 ping 一次，超时就当掉线处理，避免页面一直显示旧的工作区快照。
 */
const startHeartbeat = (active: DesktopClient) => {
  stopHeartbeat()
  heartbeatTimer = window.setInterval(() => {
    if (client !== active) {
      return
    }
    void active.request('ping', undefined, 4000).catch(() => {
      if (client === active) {
        handleUnexpectedClose(active)
      }
    })
  }, 10000)
}

const scheduleReconnect = () => {
  if (!wantConnected || reconnectTimer !== null || reconnectAttempt >= 5) {
    return
  }
  const delay = Math.min(10000, 1200 * 2 ** reconnectAttempt)
  reconnectAttempt += 1
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    if (wantConnected) {
      void connectDesktop()
    }
  }, delay)
}

/** 关掉当前客户端；先摘掉回调，避免主动断开触发重连 */
const teardownClient = () => {
  stopHeartbeat()
  const active = client
  client = null
  if (active) {
    active.onClose = null
    active.close()
  }
  unregisterTools((definition) => definition.serverId === 'desktop')
}

/**
 * 桌面端掉线：清掉旧的工作区快照（否则页面会一直显示断开前的目录），
 * 然后按退避重连。桌面端重启换工作区时，这一步会带回新的 serverInfo。
 */
const handleUnexpectedClose = (closed: DesktopClient) => {
  if (client !== closed) {
    return
  }
  stopHeartbeat()
  client = null
  closed.onClose = null
  closed.close()
  unregisterTools((definition) => definition.serverId === 'desktop')
  useDesktop.setState({
    status: 'disconnected',
    info: undefined,
    toolCount: 0,
    error: '桌面端连接已断开，正在重连…',
  })
  scheduleReconnect()
}

const DESKTOP_TOOLS: Record<string, { risk: ToolDefinition['risk']; approval?: boolean; icon: string }> = {
  desk_fs_read: { risk: 'safe', icon: 'file' },
  desk_fs_list: { risk: 'safe', icon: 'folder' },
  desk_fs_stat: { risk: 'safe', icon: 'info' },
  desk_fs_write: { risk: 'write', approval: true, icon: 'file' },
  desk_fs_delete: { risk: 'write', approval: true, icon: 'trash' },
  desk_fs_move: { risk: 'write', approval: true, icon: 'move' },
  desk_shell_exec: { risk: 'exec', approval: true, icon: 'terminal' },
  desk_python_exec: { risk: 'exec', approval: true, icon: 'code' },
  desk_system_info: { risk: 'safe', icon: 'chip' },
  desk_screen_capture: { risk: 'safe', icon: 'desktop' },
  desk_mouse: { risk: 'exec', approval: true, icon: 'desktop' },
  desk_keyboard: { risk: 'exec', approval: true, icon: 'terminal' },
  desk_window: { risk: 'write', approval: true, icon: 'desktop' },
  // 移植过来的扩展工具：只读的默认免确认，会写盘或读隐私的仍然要确认
  desk_hash: { risk: 'safe', icon: 'code' },
  desk_grep: { risk: 'safe', icon: 'search' },
  desk_archive: { risk: 'write', approval: true, icon: 'folder' },
  desk_json_query: { risk: 'safe', icon: 'code' },
  desk_net_probe: { risk: 'network', icon: 'globe' },
  desk_process_list: { risk: 'safe', icon: 'chip' },
  desk_text_stats: { risk: 'safe', icon: 'file' },
  desk_clipboard: { risk: 'write', approval: true, icon: 'clipboard' },
  desk_git: { risk: 'safe', icon: 'move' },
  // one_cedric 移植工具：只读的免确认，落盘与联网的仍要确认
  desk_glob: { risk: 'safe', icon: 'folder' },
  desk_diff: { risk: 'safe', icon: 'code' },
  desk_calculate: { risk: 'safe', icon: 'code' },
  desk_time: { risk: 'safe', icon: 'clock' },
  desk_regex: { risk: 'safe', icon: 'search' },
  desk_codec: { risk: 'safe', icon: 'code' },
  desk_csv: { risk: 'safe', icon: 'file' },
  desk_sqlite: { risk: 'safe', icon: 'database' },
  desk_tree: { risk: 'safe', icon: 'folder' },
  desk_dupes: { risk: 'safe', icon: 'search' },
  desk_net: { risk: 'network', icon: 'globe' },
  desk_password: { risk: 'safe', icon: 'code' },
  desk_markdown: { risk: 'safe', icon: 'file' },
  desk_similarity: { risk: 'safe', icon: 'search' },
  desk_pdf: { risk: 'safe', icon: 'file' },
  desk_download: { risk: 'network', approval: true, icon: 'download' },
  desk_image: { risk: 'write', approval: true, icon: 'image' },
  desk_qr: { risk: 'write', approval: true, icon: 'image' },
  desk_office: { risk: 'write', approval: true, icon: 'file' },
}

const toArtifacts = async (
  tools: string,
  result: McpCallResult,
  sessionId: string
): Promise<{
  text: string
  artifacts: Awaited<ReturnType<typeof createArtifact>>[]
  /** 截图等图片同时回传给模型，否则模型只看到一句「已截图」 */
  images: ToolImage[]
}> => {
  const texts: string[] = []
  const artifacts: Awaited<ReturnType<typeof createArtifact>>[] = []
  const images: ToolImage[] = []
  for (const [index, item] of result.content.entries()) {
    if (item.type === 'text') {
      texts.push(item.text)
      continue
    }
    if (item.type === 'image') {
      const artifact = await createArtifact({
        name: `desktop-screen-${Date.now() % 100000}-${index + 1}.png`,
        dataUrl: `data:${item.mimeType};base64,${item.data}`,
        mime: item.mimeType,
        source: 'desktop',
        tool: tools,
        sessionId,
      })
      artifacts.push(artifact)
      images.push({ mediaType: item.mimeType, data: item.data, name: artifact.name })
      texts.push(`（截图已保存为 ${artifact.name}）`)
    }
  }
  return { text: texts.join('\n\n') || '（无输出）', artifacts, images }
}

const registerDesktopTools = (tools: McpToolInfo[], active: DesktopClient) => {
  const registered: RegisteredTool[] = tools.map((tool) => {
    const exposed = tool.name.startsWith('desk_') ? tool.name : `desk_${tool.name}`
    const meta = DESKTOP_TOOLS[exposed]
    const readOnly = tool.annotations?.readOnlyHint === true
    const definition: ToolDefinition = {
      name: exposed,
      // 优先用 MCP 注解里的标题，其次退回去掉前缀的工具名
      label: tool.annotations?.title || tool.name.replace(/^desk_/, ''),
      // 桥接工具的描述带 "[服务器名] " 前缀，分组已经标出来源，这里去掉避免重复
      description: tool.server ? tool.description.replace(/^\[[^\]]+\]\s*/, '') : tool.description,
      inputSchema: {
        type: 'object',
        ...(tool.inputSchema as Record<string, unknown>),
      },
      source: exposed.startsWith('desk_mcp_') ? 'mcp' : 'desktop',
      serverId: tool.server ? `desktop:${tool.server}` : 'desktop',
      // 桥接的 stdio 服务器单独成组，避免与本机工具同名混淆
      serverName: tool.server ? `本机 · ${tool.server}` : '本机桌面端',
      risk: meta?.risk ?? (readOnly ? 'safe' : 'write'),
      requiresApproval: meta?.approval ?? !readOnly,
      icon: meta?.icon ?? 'desktop',
    }
    return {
      definition,
      execute: async (input, context) => {
        if (context.signal.aborted) {
          return { content: '已停止', isError: true }
        }
        context.progress('正在本机执行…')
        try {
          const result = await active.callTool(tool.name, input)
          const { text, artifacts, images } = await toArtifacts(
            tool.name,
            result,
            context.sessionId
          )
          return {
            content: text,
            isError: result.isError,
            artifacts,
            ...(images.length ? { images } : {}),
          }
        } catch (error) {
          return {
            content: `桌面端执行失败：${error instanceof Error ? error.message : String(error)}`,
            isError: true,
          }
        }
      },
    }
  })
  registerTools(registered)
}

/**
 * 切换本机工作区：直接调用桥接的 desk_workspace 工具。
 * 这是用户在选择器里的主动操作，不需要再走一遍审批。
 */
export const switchDesktopWorkspace = async (path: string): Promise<boolean> => {
  if (!client) {
    return false
  }
  const result = await client.callTool('desk_workspace', { action: 'use', path })
  if (result.isError) {
    return false
  }
  const info = useDesktop.getState().info
  if (info?.workspaces) {
    useDesktop.setState({
      info: {
        ...info,
        sandbox: path,
        workspaces: info.workspaces.map((item) => ({ ...item, current: item.path === path })),
      },
    })
  }
  return true
}

export const connectDesktop = async (url?: string, token?: string): Promise<void> => {
  const target = url ?? useDesktop.getState().url
  const secret = token ?? useDesktop.getState().token
  cancelReconnect()
  teardownClient()
  wantConnected = true
  useDesktop.setState({ status: 'connecting', error: undefined, url: target, token: secret })
  const next = new DesktopClient(target, secret)
  client = next
  next.onClose = () => handleUnexpectedClose(next)
  try {
    await next.connect()
    const tools = await next.listTools()
    if (client !== next) {
      return
    }
    registerDesktopTools(tools, next)
    reconnectAttempt = 0
    startHeartbeat(next)
    useDesktop.setState({
      status: 'connected',
      info: next.serverInfo ?? undefined,
      toolCount: tools.length,
      error: undefined,
    })
    try {
      localStorage.setItem(URL_KEY, target)
      localStorage.setItem(TOKEN_KEY, secret)
    } catch {
      // 忽略存储失败
    }
  } catch (error) {
    if (client === next) {
      next.onClose = null
      next.close()
      client = null
    }
    unregisterTools((definition) => definition.serverId === 'desktop')
    useDesktop.setState({
      status: 'error',
      info: undefined,
      error: error instanceof Error ? error.message : String(error),
      toolCount: 0,
    })
    scheduleReconnect()
  }
}

/**
 * 重新拉一次 serverInfo。
 * 工作区列表只在 initialize 时下发，桌面端重启或改了 config.json 后要靠它更新；
 * 选择器每次展开都会调用一次，避免一直显示连接时的旧工作区。
 */
export const refreshDesktopInfo = async (): Promise<void> => {
  const active = client
  if (!active) {
    return
  }
  try {
    const result = (await active.request('initialize', INIT_PARAMS, 2500)) as
      | { serverInfo?: DesktopInfo }
      | undefined
    if (client === active && result?.serverInfo) {
      useDesktop.setState({ info: result.serverInfo })
    }
  } catch {
    // 无响应也算掉线：清掉旧快照并重连，不要继续显示旧工作区
    if (client === active) {
      handleUnexpectedClose(active)
    }
  }
}

export const disconnectDesktop = () => {
  wantConnected = false
  reconnectAttempt = 0
  cancelReconnect()
  teardownClient()
  useDesktop.setState({ status: 'disconnected', info: undefined, toolCount: 0, error: undefined })
}

export const setDesktopAutoConnect = (autoConnect: boolean) => {
  useDesktop.setState({ autoConnect })
  try {
    localStorage.setItem(AUTO_KEY, String(autoConnect))
  } catch {
    // 忽略存储失败
  }
}

/** 页面加载时：从 URL 读取一次性令牌，或按上次设置自动连接 */
export const initDesktop = () => {
  const params = new URLSearchParams(location.search)
  const url = params.get('desktop') ?? undefined
  const token = params.get('token') ?? undefined
  if (url) {
    void connectDesktop(url, token ?? '')
    return
  }
  if (useDesktop.getState().autoConnect && useDesktop.getState().token) {
    void connectDesktop()
  }
}

export const isDesktopReady = () => useDesktop.getState().status === 'connected'

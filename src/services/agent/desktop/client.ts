import type { McpCallResult, McpContent, McpToolInfo } from '../mcp/types.js'

type RpcResponse = {
  jsonrpc?: '2.0'
  id?: number
  result?: unknown
  error?: { code: number; message: string }
}

export type DesktopInfo = {
  name: string
  version: string
  platform: string
  sandbox: string
  /** 沙箱之外额外放行的目录，默认包含 ~/.skills */
  allowed?: string[]
  /** 可切换的本机工作区；current 表示当前沙箱根 */
  workspaces?: { name: string; path: string; current: boolean }[]
  capabilities: string[]
}

/** 桌面端通过 WebSocket 暴露 MCP 语义（initialize / tools/list / tools/call） */
export class DesktopClient {
  private socket: WebSocket | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private info: DesktopInfo | null = null
  /** 桌面端意外断开时回调；主动 close() 不触发 */
  onClose: (() => void) | null = null

  constructor(
    private readonly url: string,
    private readonly token: string
  ) {}

  get serverInfo() {
    return this.info
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const target = new URL(this.url)
      if (this.token) {
        target.searchParams.set('token', this.token)
      }
      let socket: WebSocket
      try {
        socket = new WebSocket(target.href)
      } catch (error) {
        reject(new Error(`无法连接桌面端：${error instanceof Error ? error.message : String(error)}`))
        return
      }
      this.socket = socket
      const timer = window.setTimeout(() => {
        socket.close()
        reject(new Error('连接桌面端超时，请确认桌面端已启动且端口一致'))
      }, 8000)

      socket.onopen = () => {
        void this.request('initialize', {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'chat-agent', version: '1.0.0' },
        })
          .then((result) => {
            clearTimeout(timer)
            const payload = result as { serverInfo?: DesktopInfo } | undefined
            this.info = payload?.serverInfo ?? null
            resolve()
          })
          .catch((error: unknown) => {
            clearTimeout(timer)
            reject(error instanceof Error ? error : new Error(String(error)))
          })
      }
      socket.onmessage = (event) => {
        this.handleMessage(String(event.data))
      }
      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error('桌面端连接失败，请检查地址与访问令牌'))
      }
      socket.onclose = () => {
        clearTimeout(timer)
        if (this.socket !== socket) {
          return
        }
        this.socket = null
        this.failAll('桌面端连接已断开')
        this.onClose?.()
      }
    })
  }

  private handleMessage(raw: string) {
    let payload: unknown
    try {
      payload = JSON.parse(raw)
    } catch {
      return
    }
    if (typeof payload !== 'object' || payload === null) {
      return
    }
    const response = payload as RpcResponse
    if (typeof response.id !== 'number') {
      return
    }
    const entry = this.pending.get(response.id)
    if (!entry) {
      return
    }
    this.pending.delete(response.id)
    if (response.error) {
      entry.reject(new Error(response.error.message))
    } else {
      entry.resolve(response.result)
    }
  }

  private failAll(message: string) {
    for (const [, entry] of this.pending) {
      entry.reject(new Error(message))
    }
    this.pending.clear()
  }

  request(method: string, params?: Record<string, unknown>, timeout = 120_000): Promise<unknown> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('桌面端未连接'))
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`桌面端响应超时（${method}）`))
      }, timeout)
      this.pending.set(id, {
        resolve: (value) => {
          window.clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          window.clearTimeout(timer)
          reject(error)
        },
      })
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }))
    })
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = (await this.request('tools/list')) as { tools?: unknown[] } | undefined
    const tools = Array.isArray(result?.tools) ? result.tools : []
    return tools.flatMap((item): McpToolInfo[] => {
      if (typeof item !== 'object' || item === null) {
        return []
      }
      const record = item as Record<string, unknown>
      if (typeof record.name !== 'string') {
        return []
      }
      return [
        {
          name: record.name,
          description: typeof record.description === 'string' ? record.description : '',
          inputSchema:
            typeof record.inputSchema === 'object' && record.inputSchema !== null
              ? (record.inputSchema as Record<string, unknown>)
              : { type: 'object', properties: {} },
          annotations:
            typeof record.annotations === 'object' && record.annotations !== null
              ? (record.annotations as McpToolInfo['annotations'])
              : undefined,
          server: typeof record.server === 'string' ? record.server : undefined,
        },
      ]
    })
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const result = (await this.request('tools/call', { name, arguments: args })) as
      | { content?: unknown; isError?: boolean }
      | undefined
    const content = Array.isArray(result?.content) ? result.content : []
    return {
      content: content.flatMap((item): McpContent[] => {
        if (typeof item !== 'object' || item === null) {
          return []
        }
        const record = item as Record<string, unknown>
        if (record.type === 'text' && typeof record.text === 'string') {
          return [{ type: 'text', text: record.text }]
        }
        if (record.type === 'image' && typeof record.data === 'string') {
          return [
            {
              type: 'image',
              data: record.data,
              mimeType: typeof record.mimeType === 'string' ? record.mimeType : 'image/png',
            },
          ]
        }
        return [{ type: 'text', text: JSON.stringify(record) }]
      }),
      isError: result?.isError === true,
    }
  }

  close() {
    this.failAll('桌面端连接已关闭')
    const socket = this.socket
    // 先清空引用，onclose 就不会被当成意外断开
    this.socket = null
    socket?.close()
    this.info = null
  }
}

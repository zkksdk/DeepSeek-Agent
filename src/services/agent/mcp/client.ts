import type { McpCallResult, McpContent, McpServerConfig, McpToolInfo } from './types.js'

/** JSON-RPC 2.0 帧 */
type RpcRequest = {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

type RpcResponse = {
  jsonrpc?: '2.0'
  id?: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const PROTOCOL_VERSION = '2024-11-05'
const CLIENT_INFO = { name: 'chat-agent', version: '1.0.0' }

class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number
  ) {
    super(message)
    this.name = 'RpcError'
  }
}

const parseSseChunk = (chunk: string) => {
  let event = 'message'
  const data: string[] = []
  for (const raw of chunk.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!line || line.startsWith(':')) {
      continue
    }
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') {
      event = value
    } else if (field === 'data') {
      data.push(value)
    }
  }
  return { event, data: data.join('\n') }
}

/** 逐条读取 SSE 事件；流被中止时静默退出 */
async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let index = buffer.indexOf('\n\n')
      while (index >= 0) {
        const chunk = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const parsed = parseSseChunk(chunk)
        if (parsed.data || parsed.event !== 'message') {
          yield parsed
        }
        index = buffer.indexOf('\n\n')
      }
    }
    if (buffer.trim()) {
      yield parseSseChunk(buffer)
    }
  } finally {
    reader.releaseLock()
  }
}

const isRpcResponse = (value: unknown): value is RpcResponse =>
  typeof value === 'object' && value !== null && ('result' in value || 'error' in value)

/**
 * 最小 MCP 客户端：initialize → tools/list → tools/call。
 * 支持 Streamable HTTP（POST，响应可能是 SSE）与传统 HTTP+SSE（GET 长连接 + POST 消息端点）。
 */
export class McpClient {
  private nextId = 1
  private sessionId: string | null = null
  private initialized = false
  private abort: AbortController | null = null
  private endpoint: string | null = null
  private waiting = new Map<number, (response: RpcResponse) => void>()
  private serverInfo: { name?: string; version?: string } = {}

  constructor(private readonly config: McpServerConfig) {}

  get info() {
    return this.serverInfo
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
      // 不在每个请求上重复协议版本：浏览器跨域时该自定义头会触发预检，
      // 多数 MCP 服务器未在 Access-Control-Allow-Headers 中放行它。
      // 版本已在 initialize 的 body 里声明，服务端据此协商即可。
      ...(this.config.headers ?? {}),
      ...extra,
    }
  }

  private url(): string {
    if (!this.config.url) {
      throw new RpcError('MCP 服务器缺少 URL')
    }
    return this.config.url
  }

  /** 传统 SSE：先建立 GET 长连接，等 endpoint 事件确定消息地址 */
  private async openSseStream(): Promise<void> {
    const controller = new AbortController()
    this.abort = controller
    const response = await fetch(this.url(), {
      method: 'GET',
      headers: { Accept: 'text/event-stream', ...(this.config.headers ?? {}) },
      signal: controller.signal,
    })
    if (!response.ok || !response.body) {
      throw new RpcError(`SSE 连接失败：HTTP ${response.status}`)
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream')) {
      throw new RpcError('服务器没有返回事件流，请确认传输类型是否为 Streamable HTTP')
    }
    const endpointPromise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new RpcError('等待 SSE endpoint 事件超时')), 15000)
      this.endpointWaiter = (endpoint) => {
        clearTimeout(timer)
        resolve(endpoint)
      }
    })
    void (async () => {
      for await (const event of readSse(response.body as ReadableStream<Uint8Array>, controller.signal)) {
        if (event.event === 'endpoint') {
          const target = new URL(event.data, this.url()).href
          this.endpoint = target
          this.endpointWaiter?.(target)
          continue
        }
        if (!event.data) {
          continue
        }
        try {
          const payload: unknown = JSON.parse(event.data)
          if (isRpcResponse(payload) && typeof payload.id === 'number') {
            this.waiting.get(payload.id)?.(payload)
            this.waiting.delete(payload.id)
          }
        } catch {
          // 非 JSON 事件忽略
        }
      }
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) {
        this.failAll(error instanceof Error ? error.message : String(error))
      }
    })
    this.endpoint = await endpointPromise
  }

  private endpointWaiter: ((endpoint: string) => void) | null = null

  private failAll(message: string) {
    for (const [, resolve] of this.waiting) {
      resolve({ error: { code: -32000, message } })
    }
    this.waiting.clear()
  }

  /** 发送请求并等待对应 id 的响应 */
  private async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++
    const payload: RpcRequest = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }
    if (this.config.transport === 'sse') {
      if (!this.endpoint) {
        throw new RpcError('SSE 消息端点尚未就绪')
      }
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: this.abort?.signal,
      })
      if (!response.ok && response.status !== 202) {
        throw new RpcError(`MCP 请求失败：HTTP ${response.status} ${await response.text().catch(() => '')}`)
      }
      return this.waitFor(id)
    }

    const response = await fetch(this.url(), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal: this.abort?.signal,
    })
    const session = response.headers.get('mcp-session-id')
    if (session) {
      this.sessionId = session
    }
    if (response.status === 202 || response.status === 204) {
      return this.waitFor(id)
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new RpcError(`MCP 请求失败：HTTP ${response.status} ${body.slice(0, 300)}`)
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('text/event-stream') && response.body) {
      for await (const event of readSse(response.body, this.abort?.signal ?? new AbortController().signal)) {
        if (!event.data) {
          continue
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(event.data)
        } catch {
          continue
        }
        if (isRpcResponse(parsed) && (parsed.id === id || parsed.id === undefined)) {
          if (parsed.error) {
            throw new RpcError(parsed.error.message, parsed.error.code)
          }
          return parsed.result
        }
      }
      throw new RpcError('事件流在返回结果前结束')
    }
    const body = (await response.json()) as RpcResponse
    if (body.error) {
      throw new RpcError(body.error.message, body.error.code)
    }
    return body.result
  }

  /** SSE 传输的结果从长连接推送，按 id 等待 */
  private waitFor(id: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        reject(new RpcError('等待 MCP 响应超时'))
      }, 60000)
      this.waiting.set(id, (response) => {
        clearTimeout(timer)
        if (response.error) {
          reject(new RpcError(response.error.message, response.error.code))
        } else {
          resolve(response.result)
        }
      })
    })
  }

  private notify(method: string, params?: Record<string, unknown>) {
    const payload = { jsonrpc: '2.0', method, ...(params ? { params } : {}) }
    const target = this.config.transport === 'sse' ? this.endpoint : this.url()
    if (!target) {
      return
    }
    void fetch(target, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal: this.abort?.signal,
    }).catch(() => undefined)
  }

  async connect(): Promise<void> {
    this.abort = new AbortController()
    this.sessionId = null
    this.endpoint = null
    if (this.config.transport === 'sse') {
      await this.openSseStream()
    }
    const result = (await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { roots: { listChanged: false } },
      clientInfo: CLIENT_INFO,
    })) as { serverInfo?: { name?: string; version?: string } } | undefined
    this.serverInfo = result?.serverInfo ?? {}
    this.notify('notifications/initialized')
    this.initialized = true
  }

  async listTools(): Promise<McpToolInfo[]> {
    if (!this.initialized) {
      throw new RpcError('MCP 客户端尚未初始化')
    }
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
        },
      ]
    })
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    if (!this.initialized) {
      throw new RpcError('MCP 客户端尚未初始化')
    }
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
        if (record.type === 'resource' && typeof record.resource === 'object' && record.resource) {
          const resource = record.resource as Record<string, unknown>
          return [
            {
              type: 'resource',
              resource: {
                uri: typeof resource.uri === 'string' ? resource.uri : '',
                mimeType: typeof resource.mimeType === 'string' ? resource.mimeType : undefined,
                text: typeof resource.text === 'string' ? resource.text : undefined,
                blob: typeof resource.blob === 'string' ? resource.blob : undefined,
              },
            },
          ]
        }
        return [{ type: 'text', text: JSON.stringify(record) }]
      }),
      isError: result?.isError === true,
    }
  }

  close() {
    this.abort?.abort()
    this.abort = null
    this.initialized = false
    this.endpoint = null
    this.failAll('连接已关闭')
  }
}

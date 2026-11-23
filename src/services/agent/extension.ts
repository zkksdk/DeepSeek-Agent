import { registerTools, unregisterBySource } from './registry.js'
import type { RegisteredTool, ToolContext } from './types.js'
import { bool, clip, fail, num, objectSchema, ok, str } from './toolKit.js'
import { createArtifact } from './artifacts.js'
import { downscaleImage, splitDataUrl } from '../../utils/imageData.js'
import { isPublicWebUrl } from '../../utils/url.js'

/**
 * 网页与 Chrome 扩展的通信桥：
 * content script 注入到本页，监听 window.postMessage，再转发给 service worker 执行。
 * 网页侧不需要知道扩展 id，也不需要 externally_connectable。
 */
const CHANNEL = '__agent_chat_extension__'
const REQUEST_TIMEOUT = 20_000
const FETCH_TIMEOUT = 35_000

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: number
}

const pending = new Map<string, Pending>()
let available = false
const listeners = new Set<() => void>()

export const isExtensionAvailable = () => available

export const subscribeExtension = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const setAvailable = (value: boolean) => {
  if (available === value) {
    return
  }
  available = value
  for (const listener of listeners) {
    listener()
  }
}

const randomId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`

/** 发送一次调用；扩展未安装时立即失败，不等超时 */
export const callExtension = <T = unknown>(
  tool: string,
  args: Record<string, unknown> = {},
  timeout = REQUEST_TIMEOUT
): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const id = randomId()
    const timer = window.setTimeout(() => {
      pending.delete(id)
      reject(new Error('扩展响应超时，请确认扩展已启用且当前页未被浏览器限制'))
    }, timeout)
    pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timer,
    })
    // targetOrigin 只是再收一道口子：window.postMessage 本来就只投递给这一个窗口。
    // http(s) 下用当前 origin；file:// 等场景 origin 不是合法 targetOrigin，退回 '*'。
    const targetOrigin = /^https?:$/.test(window.location.protocol)
      ? window.location.origin
      : '*'
    window.postMessage({ [CHANNEL]: true, id, kind: 'request', tool, args }, targetOrigin)
  })
}

window.addEventListener('message', (event: MessageEvent) => {
  // 信任边界就是「同一个窗口」：content script 与页面共享 window，
  // 部分浏览器下 isolated world 发出的消息 origin 不保证与页面一致，不能用 origin 严格相等拦截。
  // 不同窗口伪造不了 source === window 的消息，这一条已经排除了外部来源。
  if (event.source !== window) {
    return
  }
  const data = event.data as Record<string, unknown> | null
  if (!data || data[CHANNEL] !== true) {
    return
  }
  if (data.kind === 'ready') {
    setAvailable(true)
    // content script 刚注入就广播过 ready；立刻 ping 一次把工具注册上，
    // 不依赖页面启动时的有限次重试（扩展晚装/晚注入时会错过）。
    void pingExtension().then((found) => {
      if (found) {
        setupExtensionTools()
      }
    })
    return
  }
  const id = typeof data.id === 'string' ? data.id : ''
  if (data.kind !== 'response' || !id) {
    return
  }
  const entry = pending.get(id)
  if (!entry) {
    return
  }
  window.clearTimeout(entry.timer)
  pending.delete(id)
  if (data.ok === true) {
    entry.resolve(data.data)
  } else {
    entry.reject(new Error(typeof data.error === 'string' ? data.error : '扩展调用失败'))
  }
})

const PING_TIMEOUT = 600

/** 探测扩展：content script 收到 ping 会立刻回 pong */
export const pingExtension = async (): Promise<boolean> => {
  try {
    await callExtension('ping', {}, PING_TIMEOUT)
    setAvailable(true)
    return true
  } catch {
    setAvailable(false)
    return false
  }
}

const requireExtension = () => {
  if (!available) {
    throw new Error('浏览器扩展未连接。请安装并启用 Agent 扩展后刷新页面。')
  }
}

const text = (data: unknown) => (typeof data === 'string' ? data : JSON.stringify(data, null, 2))

const definition = (
  name: string,
  label: string,
  description: string,
  inputSchema: RegisteredTool['definition']['inputSchema'],
  risk: RegisteredTool['definition']['risk'] = 'safe'
): RegisteredTool['definition'] => ({
  name,
  label,
  description,
  inputSchema,
  source: 'extension',
  risk,
})

const makeTool = (
  def: RegisteredTool['definition'],
  call: (args: Record<string, unknown>, context: ToolContext) => Promise<unknown>
): RegisteredTool => ({
  definition: def,
  execute: async (input, context) => {
    try {
      requireExtension()
      const data = await call(input, context)
      return ok(typeof data === 'string' ? data : text(data), {
        meta: typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : undefined,
      })
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  },
})

const extensionTools = (): RegisteredTool[] => [
  makeTool(
    definition(
      'browser_get_page',
      '读取当前页面',
      '读取用户当前标签页的标题、URL、正文纯文本与选中文字。用于总结网页、回答关于当前页面的问题。正文过长会自动截断。',
      objectSchema({
        max_chars: { type: 'number', description: '正文最大字符数，默认 12000' },
        include_selection: { type: 'boolean', description: '是否只返回选中文字，默认 false' },
        tab_id: { type: 'number', description: '指定标签页 id；省略则读取用户最近查看的网页' },
      })
    ),
    async (args) => {
      const data = (await callExtension<{ title: string; url: string; text: string; selection?: string }>(
        'get_page',
        { max_chars: num(args, 'max_chars') ?? 12000, tab_id: num(args, 'tab_id') }
      )) as { title: string; url: string; text: string; selection?: string }
      if (bool(args, 'include_selection') && data.selection) {
        return `标题：${data.title}\n链接：${data.url}\n\n选中内容：\n${clip(data.selection, 12000)}`
      }
      return [
        `标题：${data.title}`,
        `链接：${data.url}`,
        data.selection ? `\n选中内容：${clip(data.selection, 2000)}` : '',
        '',
        clip(data.text, num(args, 'max_chars') ?? 12000),
      ]
        .filter((line) => line !== '')
        .join('\n')
    }
  ),
  makeTool(
    definition(
      'browser_fetch_page',
      '扩展抓取网页',
      '通过扩展后台抓取任意 URL 的正文，不受页面跨域限制。',
      objectSchema({ url: { type: 'string' }, max_chars: { type: 'number' } }, ['url']),
      'network'
    ),
    async (args) => {
      if (!isPublicWebUrl(str(args, 'url'))) {
        throw new Error('只允许抓取公网 http/https 地址，本机与内网地址已拦截')
      }
      const data = (await callExtension<{ title: string; url: string; text: string }>(
        'fetch_page',
        { url: str(args, 'url'), max_chars: num(args, 'max_chars') ?? 12000 },
        FETCH_TIMEOUT
      )) as { title: string; url: string; text: string }
      return `标题：${data.title}\n链接：${data.url}\n\n${clip(data.text, num(args, 'max_chars') ?? 12000)}`
    }
  ),
  makeTool(
    definition(
      'browser_click',
      '点击元素',
      '在当前页面点击元素。优先用 CSS 选择器定位；也可按可见文字匹配第一个可点击元素。',
      objectSchema({
        selector: { type: 'string', description: 'CSS 选择器' },
        text: { type: 'string', description: '按可见文字查找，适用于无稳定选择器的按钮' },
        index: { type: 'number', description: '匹配到多个时取第几个，从 0 开始' },
        tab_id: { type: 'number', description: '指定标签页 id' },
      }),
      'write'
    ),
    async (args) =>
      text(
        await callExtension('click', {
          selector: str(args, 'selector'),
          text: str(args, 'text'),
          index: num(args, 'index') ?? 0,
          tab_id: num(args, 'tab_id'),
        })
      )
  ),
  makeTool(
    definition(
      'browser_type',
      '输入文本',
      '在输入框、文本域或 contenteditable 中输入文本，可选择回车提交。',
      objectSchema(
        {
          selector: { type: 'string' },
          text: { type: 'string' },
          submit: { type: 'boolean', description: '输入后按回车' },
          clear: { type: 'boolean', description: '先清空原有内容，默认 true' },
          tab_id: { type: 'number', description: '指定标签页 id' },
        },
        ['text']
      ),
      'write'
    ),
    async (args) =>
      text(
        await callExtension('type', {
          selector: str(args, 'selector'),
          text: str(args, 'text'),
          submit: bool(args, 'submit'),
          clear: args.clear !== false,
          tab_id: num(args, 'tab_id'),
        })
      )
  ),
  makeTool(
    definition(
      'browser_scroll',
      '滚动页面',
      '滚动当前页面，用于加载更多内容或查看下方区域。',
      objectSchema({
        direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'] },
        amount: { type: 'number', description: '滚动像素，默认一屏' },
        tab_id: { type: 'number', description: '指定标签页 id' },
      })
    ),
    async (args) =>
      text(
        await callExtension('scroll', {
          direction: str(args, 'direction') || 'down',
          amount: num(args, 'amount'),
          tab_id: num(args, 'tab_id'),
        })
      )
  ),
  {
    definition: definition(
      'browser_screenshot',
      '页面截图',
      '截取标签页画面，返回图片产物并在对话中展示。full_page 为 true 时滚动拼接整页（较慢，最多 8 屏）。',
      objectSchema({
        full_page: { type: 'boolean', description: '是否整页截图，默认 false' },
        tab_id: { type: 'number', description: '指定标签页 id' },
      })
    ),
    execute: async (input, context) => {
      try {
        requireExtension()
        const data = await callExtension<{ dataUrl: string; width: number; height: number; full: boolean }>(
          'screenshot',
          { full_page: bool(input, 'full_page'), tab_id: num(input, 'tab_id') },
          FETCH_TIMEOUT
        )
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const artifact = await createArtifact({
          name: `screenshot-${stamp}.png`,
          dataUrl: data.dataUrl,
          mime: 'image/png',
          source: 'extension',
          tool: 'browser_screenshot',
          sessionId: context.sessionId,
        })
        // 截图同时回传给模型：先缩到模型能接受的长边，再以 base64 图片块放进工具结果，
        // 否则模型只能看到「截了一张图」这句话，看不到画面内容。
        const payload = splitDataUrl(data.dataUrl)
        const scaled = payload ? await downscaleImage(payload, 1568) : null
        return ok(
          `已截取${data.full ? '整页' : '当前可视区域'}（${data.width}×${data.height}）`,
          {
            artifacts: [artifact],
            ...(scaled
              ? { images: [{ mediaType: scaled.mediaType, data: scaled.data, name: artifact.name }] }
              : {}),
          }
        )
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error))
      }
    },
  },
  makeTool(
    definition(
      'browser_tabs',
      '标签页管理',
      '列出、切换、打开或关闭标签页。action=list 时返回所有标签页。',
      objectSchema(
        {
          action: { type: 'string', enum: ['list', 'activate', 'open', 'close'] },
          url: { type: 'string', description: 'open 时使用' },
          tab_id: { type: 'number', description: 'activate / close 时使用' },
        },
        ['action']
      ),
      'write'
    ),
    async (args) => {
      const data = (await callExtension<{
        count?: number
        tabs?: { id: number; title: string; url: string; active: boolean }[]
      }>('tabs', {
        action: str(args, 'action') || 'list',
        url: str(args, 'url'),
        tabId: num(args, 'tab_id'),
      })) as { count?: number; tabs?: { id: number; title: string; url: string; active: boolean }[] }
      if (!data?.tabs) {
        return text(data)
      }
      const lines = data.tabs.map(
        (tab) => `[${tab.id}]${tab.active ? ' ●' : ''} ${clip(tab.title || '无标题', 60)} — ${tab.url}`
      )
      return `共 ${data.count ?? data.tabs.length} 个标签页：\n${lines.join('\n')}`
    }
  ),
  makeTool(
    definition(
      'browser_navigate',
      '页面跳转',
      '让当前标签页跳转到指定 URL。',
      objectSchema({ url: { type: 'string' }, tab_id: { type: 'number' } }, ['url']),
      'write'
    ),
    async (args) => {
      if (!isPublicWebUrl(str(args, 'url'))) {
        throw new Error('只允许跳转到公网 http/https 地址，本机与内网地址已拦截')
      }
      return text(await callExtension('navigate', { url: str(args, 'url'), tab_id: num(args, 'tab_id') }))
    }
  ),
  makeTool(
    definition(
      'browser_extract',
      '提取页面元素',
      '按 CSS 选择器批量提取文本或属性，适合抓列表、表格、链接。',
      objectSchema(
        {
          selector: { type: 'string' },
          attribute: { type: 'string', description: '要读取的属性名，如 href；省略则取文本' },
          limit: { type: 'number', description: '最多返回条数，默认 50' },
          tab_id: { type: 'number', description: '指定标签页 id' },
        },
        ['selector']
      )
    ),
    async (args) => text(await callExtension('extract', {
      selector: str(args, 'selector'),
      attribute: str(args, 'attribute'),
      limit: num(args, 'limit') ?? 50,
      tab_id: num(args, 'tab_id'),
    }))
  ),
]

export const setupExtensionTools = () => {
  registerTools(extensionTools())
}

export const teardownExtensionTools = () => unregisterBySource('extension')

/** 页面加载后探测；扩展可能稍后才注入，未连接时持续探测而不是放弃 */
export const initExtensionBridge = () => {
  const check = async () => {
    const found = await pingExtension()
    if (found) {
      setupExtensionTools()
    }
  }
  void check()
  // 未连接时每 5 秒再试：扩展重载、浏览器恢复休眠标签页后都能自愈
  window.setInterval(() => {
    if (!available) {
      void check()
    }
  }, 5000)
  // 扩展被重载或页面从后台恢复时重新探测
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !available) {
      void check()
    }
  })
}

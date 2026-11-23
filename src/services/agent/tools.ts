/**
 * 客户端智能体工具：完全在前端本地执行，不产生额外费用，也不依赖服务端额外能力。
 * 模型通过标准 Anthropic tools 协议自主决定调用；结果以 tool_result 回传后继续推理。
 */
import type { ClientToolDefinition } from '../api/types.js'
import { addHttpSkill } from './skills.js'
import { addMcpServer } from './mcp.js'
import { getCurrentPosition } from '../platform/geolocation.js'
import { streamMessage } from '../api/client.js'
import { useSettings } from '../settings.js'
import { addMemory, readMemories, removeMemory } from './memory.js'
import { useWorkspaces } from '../chat/workspaces.js'

export const AGENT_TOOLS: ClientToolDefinition[] = [
  {
    name: 'get_current_time',
    description:
      '获取当前日期与时间。需要知道今天日期、当前时间或做时间计算时使用。可选传入 IANA 时区，如 Asia/Shanghai。',
    input_schema: {
      type: 'object',
      properties: {
        timezone: { type: 'string', description: 'IANA 时区，例如 Asia/Shanghai；默认使用用户本地时区' },
      },
    },
  },
  {
    name: 'calculate',
    description:
      '精确计算数学表达式，支持 + - * / % ^ 和括号。凡涉及数值计算都应调用，避免心算错误。',
    input_schema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: '数学表达式，例如 (3+4)*2^3' },
      },
      required: ['expression'],
    },
  },
  {
    name: 'text_stats',
    description: '统计文本的字符数、不含空白字符数、单词数、行数。',
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string', description: '待统计的文本' } },
      required: ['text'],
    },
  },
  {
    name: 'json_format',
    description: '格式化或压缩 JSON 文本；可校验 JSON 是否合法。',
    input_schema: {
      type: 'object',
      properties: {
        json: { type: 'string', description: 'JSON 字符串' },
        mode: { type: 'string', description: 'pretty（美化，默认）或 minify（压缩）' },
      },
      required: ['json'],
    },
  },
  {
    name: 'random_number',
    description: '生成指定区间内的随机整数（含两端）。',
    input_schema: {
      type: 'object',
      properties: {
        min: { type: 'number', description: '最小值（含）' },
        max: { type: 'number', description: '最大值（含）' },
      },
      required: ['min', 'max'],
    },
  },
  {
    name: 'get_user_location',
    description:
      '获取用户当前的地理位置（经纬度）。使用浏览器定位，首次调用需用户授权；用户拒绝或定位失败时会返回错误。',
    input_schema: {
      type: 'object',
      properties: {
        highAccuracy: {
          type: 'boolean',
          description: '是否要求高精度定位，默认 false',
        },
      },
    },
  },
  {
    name: 'propose_skill',
    description:
      '为用户新增一个自定义 HTTP 技能（工具）。仅在用户明确要求添加/创建技能时使用。创建后为待确认状态，需用户在设置中启用。',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '技能名，英文/数字/下划线' },
        description: { type: 'string', description: '技能用途描述' },
        method: { type: 'string', description: 'GET 或 POST，默认 GET' },
        url: { type: 'string', description: '接口地址，可含 {参数} 占位符' },
        params: {
          type: 'array',
          description: '参数列表',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              required: { type: 'boolean' },
            },
          },
        },
        headers: { type: 'object', description: '可选请求头（字符串值）' },
        bodyTemplate: { type: 'string', description: 'POST 请求体模板，可含 {参数}' },
      },
      required: ['name', 'url'],
    },
  },
  {
    name: 'propose_mcp_server',
    description:
      '为用户登记一个 MCP 服务器。仅在用户明确要求接入/添加 MCP 时使用。登记后为待确认状态，需用户启用并连接。',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '服务器名称' },
        url: { type: 'string', description: 'MCP Streamable HTTP 地址' },
      },
      required: ['name', 'url'],
    },
  },
  {
    name: 'spawn_agents',
    description:
      '将多个相互独立的子任务交给子智能体并行处理（每个子代理一次独立模型调用，独立上下文）。可指定 name（标签）与 system（角色设定），返回每个子代理的状态、耗时与结果。不要用于相互依赖的任务。',
    input_schema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: '简单子任务列表（字符串）。与 agents 二选一，agents 优先',
          items: { type: 'string' },
        },
        agents: {
          type: 'array',
          description: '结构化子任务列表，优先于 tasks',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '子代理名称/标签' },
              task: { type: 'string', description: '子任务指令' },
              system: { type: 'string', description: '该子代理的角色设定（可选）' },
            },
            required: ['task'],
          },
        },
        concurrency: { type: 'number', description: '并发数，默认 3，最大 6' },
      },
    },
  },
  {
    name: 'remember_fact',
    description:
      '记住关于用户的一条长期信息（偏好、习惯、背景、约束等）。仅在用户明确要求记住，或信息明显值得长期保存时使用。',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '要记住的一句话，尽量简洁具体' },
      },
      required: ['content'],
    },
  },
  {
    name: 'list_memory',
    description:
      '列出长期记忆中的条目（含 id），用于查看与整理。scope：all=全部，global=仅全局，workspace=当前工作区及全局（默认）。',
    input_schema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'all | global | workspace（默认）' },
      },
    },
  },
  {
    name: 'forget_fact',
    description: '从长期记忆中删除一条信息，按内容精确匹配或记忆 id。',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '要删除的记忆内容或 id' },
      },
      required: ['target'],
    },
  },
  {
    name: 'fetch_url',
    description:
      '读取一个公开网页的纯文本内容（去除脚本与标签），最多返回约 4000 字。受浏览器跨域限制，部分站点可能失败。',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: '以 http(s) 开头的完整地址' } },
      required: ['url'],
    },
  },
]

export const AGENT_TOOL_NAMES = new Set(AGENT_TOOLS.map((tool) => tool.name))

export type ToolRunResult = { content: string; isError: boolean }

/** 递归下降解析四则表达式，不执行任意代码 */
const evaluateExpression = (expression: string): number => {
  const s = expression.replace(/\s+/g, '')
  if (!s) {
    throw new Error('表达式为空')
  }
  if (!/^[0-9+\-*/%^().]+$/.test(s)) {
    throw new Error('表达式包含不支持的字符')
  }
  let i = 0
  const peek = () => s[i]

  const parseExpr = (): number => {
    let value = parseTerm()
    while (peek() === '+' || peek() === '-') {
      const op = s[i]
      i += 1
      const right = parseTerm()
      value = op === '+' ? value + right : value - right
    }
    return value
  }
  const parseTerm = (): number => {
    let value = parseFactor()
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = s[i]
      i += 1
      const right = parseFactor()
      if ((op === '/' || op === '%') && right === 0) {
        throw new Error('除数不能为 0')
      }
      value = op === '*' ? value * right : op === '/' ? value / right : value % right
    }
    return value
  }
  const parseFactor = (): number => {
    const base = parseUnary()
    if (peek() === '^') {
      i += 1
      return base ** parseFactor()
    }
    return base
  }
  const parseUnary = (): number => {
    if (peek() === '-') {
      i += 1
      return -parseUnary()
    }
    if (peek() === '+') {
      i += 1
      return parseUnary()
    }
    if (peek() === '(') {
      i += 1
      const value = parseExpr()
      if (peek() !== ')') {
        throw new Error('括号不匹配')
      }
      i += 1
      return value
    }
    const start = i
    while (i < s.length && /[0-9.]/.test(s[i])) {
      i += 1
    }
    if (start === i) {
      throw new Error('表达式不完整')
    }
    const value = Number(s.slice(start, i))
    if (!Number.isFinite(value)) {
      throw new Error('数字格式错误')
    }
    return value
  }

  const result = parseExpr()
  if (i !== s.length) {
    throw new Error('表达式无法解析')
  }
  if (!Number.isFinite(result)) {
    throw new Error('计算结果不是有限数')
  }
  return result
}

const asRecord = (input: unknown): Record<string, unknown> =>
  typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

const stripHtml = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()

/** 定位错误转成可读原因 */
const geolocationMessage = (error: unknown): string | null => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: number }).code
    if (code === 1) {
      return '用户拒绝了定位授权'
    }
    if (code === 2) {
      return '定位不可用（信号或系统限制）'
    }
    if (code === 3) {
      return '定位超时'
    }
  }
  return null
}

type SubAgentTask = { name: string; task: string; system?: string }
type SubAgentResult = {
  name: string
  ok: boolean
  ms: number
  text: string
  /** 绝对起止时间（毫秒），用于计算真实并发重叠 */
  start: number
  end: number
}

/** 单个子代理的超时时间 */
const SUB_AGENT_TIMEOUT = 90_000
const DEFAULT_SUB_AGENT_SYSTEM =
  '你是一个专注执行单一子任务的子代理。只输出任务结果本身，结构清晰、简洁准确，不要寒暄。'

/** 子代理：独立上下文、不开工具，只负责把单个子任务做完 */
const runSubAgent = async (spec: SubAgentTask, signal?: AbortSignal): Promise<SubAgentResult> => {
  const started = Date.now()
  const { apiKey, model, thinking } = useSettings.getState()
  if (!apiKey) {
    const now = Date.now()
    return { name: spec.name, ok: false, ms: 0, text: '（未配置 API Key，无法执行子任务）', start: now, end: now }
  }
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  const timer = setTimeout(() => controller.abort(), SUB_AGENT_TIMEOUT)
  try {
    const events = streamMessage(
      apiKey,
      {
        model,
        system: spec.system?.trim() || DEFAULT_SUB_AGENT_SYSTEM,
        messages: [{ role: 'user', content: spec.task }],
        thinking: { type: thinking ? 'enabled' : 'disabled' },
        safety_check: { level: 'high' },
        tools: [],
      },
      controller.signal
    )
    let text = ''
    for await (const event of events) {
      if (event.type === 'content_block_start' && event.content_block.type === 'text') {
        text += event.content_block.text
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
      }
    }
    const ended = Date.now()
    return {
      name: spec.name,
      ok: true,
      ms: ended - started,
      text: text.trim() || '（空结果）',
      start: started,
      end: ended,
    }
  } catch (error) {
    const timedOut = controller.signal.aborted && !signal?.aborted
    const ended = Date.now()
    return {
      name: spec.name,
      ok: false,
      ms: ended - started,
      text: timedOut
        ? `超时（>${SUB_AGENT_TIMEOUT / 1000}s）`
        : `失败：${error instanceof Error ? error.message : String(error)}`,
      start: started,
      end: ended,
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** 扫描线计算区间最大重叠数（真实同时运行的任务数） */
const maxOverlap = (ranges: { start: number; end: number }[]): number => {
  const events: { t: number; delta: number }[] = []
  for (const range of ranges) {
    events.push({ t: range.start, delta: 1 })
    events.push({ t: range.end, delta: -1 })
  }
  // 同一时刻先结束后开始，避免边界误判为重叠
  events.sort((a, b) => (a.t === b.t ? a.delta - b.delta : a.t - b.t))
  let current = 0
  let max = 0
  for (const event of events) {
    current += event.delta
    if (current > max) {
      max = current
    }
  }
  return max
}

/** 限制并发的并行执行，结果按输入顺序返回 */
const runWithConcurrency = async (
  specs: SubAgentTask[],
  limit: number,
  signal?: AbortSignal
): Promise<SubAgentResult[]> => {
  const results: SubAgentResult[] = new Array(specs.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < specs.length) {
      const index = cursor
      cursor += 1
      results[index] = await runSubAgent(specs[index], signal)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, specs.length) }, () => worker()))
  return results
}

/** 执行一次工具调用；未知工具或异常都返回 isError 结果，交由模型自行处理 */
export const runTool = async (
  name: string,
  input: unknown,
  signal?: AbortSignal
): Promise<ToolRunResult> => {
  try {
    const args = asRecord(input)
    switch (name) {
      case 'get_current_time': {
        const timezone = asString(args.timezone).trim()
        const now = new Date()
        let formatted: string
        try {
          formatted = now.toLocaleString('zh-CN', {
            timeZone: timezone || undefined,
            dateStyle: 'full',
            timeStyle: 'long',
          })
        } catch {
          formatted = now.toLocaleString('zh-CN')
        }
        return {
          isError: false,
          content: `${formatted}（ISO: ${now.toISOString()}）`,
        }
      }
      case 'calculate': {
        const expression = asString(args.expression)
        if (!expression.trim()) {
          throw new Error('缺少 expression')
        }
        const result = evaluateExpression(expression)
        return { isError: false, content: `${expression} = ${result}` }
      }
      case 'text_stats': {
        const text = asString(args.text)
        const chars = text.length
        const noSpace = text.replace(/\s/g, '').length
        const words = text.trim() ? text.trim().split(/\s+/).length : 0
        const lines = text ? text.split(/\r?\n/).length : 0
        return {
          isError: false,
          content: `字符数 ${chars}，不含空白 ${noSpace}，单词数 ${words}，行数 ${lines}`,
        }
      }
      case 'json_format': {
        const raw = asString(args.json)
        if (!raw.trim()) {
          throw new Error('缺少 json')
        }
        const parsed = JSON.parse(raw) as unknown
        const mode = asString(args.mode).toLowerCase() === 'minify' ? 'minify' : 'pretty'
        return {
          isError: false,
          content: mode === 'minify' ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2),
        }
      }
      case 'random_number': {
        const min = Number(args.min)
        const max = Number(args.max)
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
          throw new Error('min/max 必须是数字')
        }
        const low = Math.ceil(Math.min(min, max))
        const high = Math.floor(Math.max(min, max))
        const value = Math.floor(Math.random() * (high - low + 1)) + low
        return { isError: false, content: `[${low}, ${high}] 随机整数：${value}` }
      }
      case 'get_user_location': {
        const highAccuracy = args.highAccuracy === true
        const coords = await getCurrentPosition({ highAccuracy })
        return {
          isError: false,
          content: `纬度 ${coords.latitude.toFixed(6)}，经度 ${coords.longitude.toFixed(6)}（精度约 ${Math.round(coords.accuracy)} 米）`,
        }
      }
      case 'propose_skill': {
        const name = asString(args.name).trim()
        const url = asString(args.url).trim()
        if (!name || !/^https?:\/\//i.test(url)) {
          throw new Error('需要通过 name 与非空的 http(s) url')
        }
        const paramsRaw = Array.isArray(args.params) ? args.params : []
        const params = paramsRaw.map((item) => {
          const record = asRecord(item)
          return {
            name: asString(record.name),
            description: asString(record.description) || undefined,
            required: record.required === true,
          }
        }).filter((item) => item.name)
        const headers =
          typeof args.headers === 'object' && args.headers !== null
            ? Object.fromEntries(
                Object.entries(asRecord(args.headers))
                  .filter(([, value]) => typeof value === 'string')
                  .map(([key, value]) => [key, value as string])
              )
            : undefined
        addHttpSkill({
          id: `skill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          name: name.slice(0, 40),
          description: asString(args.description) || `自定义技能 ${name}`,
          method: asString(args.method).toUpperCase() === 'POST' ? 'POST' : 'GET',
          url,
          headers,
          bodyTemplate: asString(args.bodyTemplate) || undefined,
          params,
          enabled: false,
        })
        return {
          isError: false,
          content: `已创建技能「${name}」(待确认)。请在 设置 → MCP 与技能 中启用后生效。`,
        }
      }
      case 'propose_mcp_server': {
        const added = addMcpServer(asString(args.name), asString(args.url), false)
        if (!added) {
          throw new Error('名称不能为空，且 url 需以 http(s):// 开头')
        }
        return {
          isError: false,
          content: `已登记 MCP 服务器「${added.name}」(待确认)。请在 设置 → MCP 与技能 中启用并连接。`,
        }
      }
      case 'spawn_agents': {
        const specs: SubAgentTask[] = []
        const rawAgents = Array.isArray(args.agents) ? args.agents : []
        for (const item of rawAgents.slice(0, 8)) {
          const record = asRecord(item)
          const task = asString(record.task).trim()
          if (!task) {
            continue
          }
          specs.push({
            name: asString(record.name).trim() || `子任务 ${specs.length + 1}`,
            task,
            system: asString(record.system) || undefined,
          })
        }
        if (specs.length === 0) {
          const rawTasks = Array.isArray(args.tasks) ? args.tasks : []
          for (const item of rawTasks.slice(0, 8)) {
            const task = asString(item).trim()
            if (task) {
              specs.push({ name: `子任务 ${specs.length + 1}`, task })
            }
          }
        }
        if (specs.length === 0) {
          throw new Error('tasks 或 agents 不能为空')
        }
        const parsedLimit = Number(args.concurrency)
        const limit = Number.isFinite(parsedLimit)
          ? Math.min(Math.max(Math.floor(parsedLimit), 1), 6)
          : Math.min(3, specs.length)
        const startedAll = Date.now()
        const results = await runWithConcurrency(specs, limit, signal)
        const totalMs = Date.now() - startedAll
        const okCount = results.filter((result) => result.ok).length
        const slowest = Math.max(...results.map((result) => result.ms))
        const overlap = maxOverlap(results)
        const header = `共 ${results.length} 个子代理：成功 ${okCount}，失败 ${
          results.length - okCount
        }（并发上限 ${limit}，实测最大同时运行 ${overlap}，总耗时 ${(totalMs / 1000).toFixed(
          1
        )}s，最慢 ${(slowest / 1000).toFixed(1)}s）`
        const body = results
          .map(
            (result) =>
              `### ${result.name} ${result.ok ? '✅' : '❌'} ${(result.ms / 1000).toFixed(1)}s\n${result.text}`
          )
          .join('\n\n')
        return { isError: false, content: `${header}\n\n${body}` }
      }
      case 'remember_fact': {
        const item = addMemory(asString(args.content), useWorkspaces.getState().activeId)
        if (!item) {
          throw new Error('content 不能为空')
        }
        return { isError: false, content: `已记住：${item.content}` }
      }
      case 'list_memory': {
        const all = readMemories()
        const scope = asString(args.scope).toLowerCase()
        const workspaceId = useWorkspaces.getState().activeId
        const filtered =
          scope === 'all'
            ? all
            : scope === 'global'
              ? all.filter((item) => !item.workspaceId)
              : all.filter((item) => !item.workspaceId || item.workspaceId === workspaceId)
        if (filtered.length === 0) {
          return { isError: false, content: '当前没有记忆' }
        }
        const lines = filtered.map(
          (item, index) =>
            `${index + 1}. [${item.workspaceId ? '工作区' : '全局'}] ${item.content}`
        )
        return { isError: false, content: `共 ${filtered.length} 条记忆：\n${lines.join('\n')}` }
      }
      case 'forget_fact': {
        const removed = removeMemory(asString(args.target))
        return removed > 0
          ? { isError: false, content: `已删除 ${removed} 条记忆` }
          : { isError: true, content: '未找到匹配的记忆' }
      }
      case 'fetch_url': {
        const url = asString(args.url).trim()
        if (!/^https?:\/\//i.test(url)) {
          throw new Error('url 必须以 http(s):// 开头')
        }
        const response = await fetch(url, { signal, headers: { Accept: 'text/html,text/plain' } })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const raw = await response.text()
        const text = stripHtml(raw).slice(0, 4000)
        return { isError: false, content: text || '（页面无可用文本）' }
      }
      default:
        return { isError: true, content: `未知工具：${name}` }
    }
  } catch (error) {
    return {
      isError: true,
      content: `工具执行失败：${
        geolocationMessage(error) ??
        (error instanceof Error ? error.message : String(error))
      }`,
    }
  }
}

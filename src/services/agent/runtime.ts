import type { ClientToolDefinition } from '../api/types.js'
import type { AssistantMessage, ReplyBlock, ToolCallPart } from '../chat/types.js'
import { useSettings } from '../settings.js'
import { clipText } from '../../utils/format.js'
import { requestApproval } from './approval.js'
import { getTool, listTools, runTool } from './registry.js'
import { startTask, type TaskHandle } from './tasks.js'
import type { ApprovalDecision, ToolDefinition, ToolResult } from './types.js'
import { needsApproval, sourceLabel } from './types.js'

/** 单次工具结果进入上下文的最大长度，避免长输出挤掉对话 */
const MAX_RESULT_CHARS = 24_000
/** 超过该长度时先截断再回传，原文仍保留在工具卡片的完整结果里 */
const clipResult = (text: string) =>
  text.length <= MAX_RESULT_CHARS
    ? text
    : `${clipText(text, MAX_RESULT_CHARS)}\n\n…（结果过长已截断，共 ${text.length} 字符）`

/** 工具默认超时：本机执行可能较慢；个别工具（如等待用户回答）可以覆盖为无限 */
const timeoutFor = (definition: ToolDefinition) =>
  definition.timeoutMs ??
  (definition.source === 'desktop' ? 300_000 : definition.source === 'mcp' ? 180_000 : 90_000)

/**
 * 每个工具 schema 都会附上一个必填的 purpose 字段。
 * 它只用于界面展示「这次调用要做什么」，执行前会被剥离，不影响工具本身。
 * 必填是为了让每一行工具调用都有一个人话标题，而不是一串工具名加路径。
 */
const PURPOSE_SCHEMA = {
  type: 'string',
  description:
    '必填。用一句不超过 14 个字的短语说明这次调用要达成的目的，会直接显示给用户（例如「调整对话界面样式」「读取配置」「跑一遍测试」）。不要写工具名。',
} as const

/**
 * 生成给模型的工具声明。MCP 返回的 schema 可能缺少 type，
 * 统一补成 object，避免服务端校验失败。
 */
export const buildToolDeclarations = (): ClientToolDefinition[] =>
  listTools()
    .filter((definition) => definition.name.length <= 64)
    .map((definition) => {
      const schema = definition.inputSchema as Record<string, unknown>
      const properties =
        typeof schema.properties === 'object' && schema.properties !== null
          ? (schema.properties as Record<string, unknown>)
          : {}
      const required = Array.isArray(schema.required)
        ? (schema.required as string[]).filter((key) => key !== 'purpose')
        : []
      return {
        name: definition.name,
        description: `${definition.description}\n\n[来源：${sourceLabel(definition.source)}${definition.serverName ? ` / ${definition.serverName}` : ''}]`,
        input_schema: {
          ...schema,
          type: 'object',
          properties: Object.hasOwn(properties, 'purpose')
            ? properties
            : { ...properties, purpose: PURPOSE_SCHEMA },
          // purpose 排在最后：模型按顺序生成参数，最后补一句目的最自然
          required: [...required, 'purpose'],
        } as ClientToolDefinition['input_schema'],
      }
    })

/** 模型给的 purpose：优先用工具参数里的，缺失时返回空串由调用方兜底 */
export const readPurpose = (input: unknown): string => {
  if (!input || typeof input !== 'object') {
    return ''
  }
  const value = (input as Record<string, unknown>).purpose
  return typeof value === 'string' ? value.trim().slice(0, 80) : ''
}

export const describeToolInput = (input: unknown): string => {
  if (input === null || input === undefined) {
    return ''
  }
  if (typeof input !== 'object') {
    return String(input)
  }
  const record = input as Record<string, unknown>
  const priority = [
    'path',
    'command',
    'url',
    'query',
    'selector',
    'name',
    'location',
    'question',
    'code',
    'text',
  ]
  for (const key of priority) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return value.length > 80 ? `${value.slice(0, 80)}…` : value
    }
  }
  const first = Object.entries(record).find(
    ([key, value]) => key !== 'purpose' && typeof value === 'string'
  )
  return typeof first?.[1] === 'string' ? (first[1] as string).slice(0, 80) : ''
}

const updateCall = (
  reply: AssistantMessage,
  id: string,
  update: (block: ToolCallPart) => ToolCallPart
): AssistantMessage => {
  let changed = false
  const blocks = reply.blocks.map((block) => {
    if (block.type === 'tool_use' && block.id === id) {
      changed = true
      return update(block)
    }
    return block
  })
  return changed ? { ...reply, blocks } : reply
}

const appendResult = (reply: AssistantMessage, result: ReplyBlock): AssistantMessage => ({
  ...reply,
  blocks: [...reply.blocks, result],
})

/** 用 AbortSignal 与超时竞争，任一触发都让工具尽快结束 */
const withTimeout = async <T>(
  task: (signal: AbortSignal) => Promise<T>,
  parent: AbortSignal,
  timeout: number
): Promise<T> => {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  parent.addEventListener('abort', onAbort, { once: true })
  // Infinity 表示不设超时：等待用户回答这类工具只由用户或停止按钮结束
  const timer = Number.isFinite(timeout) ? setTimeout(() => controller.abort(), timeout) : undefined
  try {
    return await task(controller.signal)
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    parent.removeEventListener('abort', onAbort)
  }
}

export type RunToolsOptions = {
  sessionId: string
  signal: AbortSignal
  /** 每次状态变化写回消息，界面据此刷新 */
  update: (reply: AssistantMessage) => void
  /** 通知动画层：工具开始/结束 */
  onEvent?: (event: 'start' | 'finish', call: ToolCallPart) => void
}

/** 开启「长任务转后台」后，工具跑过这个时长就自动脱离前台等待 */
const AUTO_DETACH_MS = 20_000

/** 前台一旦转入后台，用这个哨兵值结束等待 */
const DETACHED = { kind: 'detached' } as const
type RunOutcome = ToolResult | typeof DETACHED
const isDetached = (value: RunOutcome): value is typeof DETACHED => 'kind' in value

/**
 * 执行本轮所有工具调用：
 * 1. 审批阶段顺序进行，确认面板不会一次叠好几层；
 * 2. 执行阶段按设置并行，单个工具随时可以「转入后台」，
 *    前台拿到一条占位结果继续对话，真正的结果留在任务面板里。
 */
export const runToolCalls = async (
  initial: AssistantMessage,
  options: RunToolsOptions
): Promise<AssistantMessage> => {
  let reply = initial
  const calls = reply.blocks.filter(
    (block): block is ToolCallPart => block.type === 'tool_use' && block.status === 'pending'
  )
  // 设置里把审批切成「完全访问」后不再逐个弹窗，直接执行；
  // 默认仍是每次询问，危险操作由用户当场决定
  const settings = useSettings.getState()
  const autoApprove = settings.toolApproval === 'auto'
  const approved: { call: ToolCallPart; definition: ToolDefinition }[] = []

  for (const call of calls) {
    if (options.signal.aborted) {
      break
    }
    const definition = getTool(call.name)?.definition
    const startedAt = Date.now()

    // 未知工具也要走完流程，把明确错误交给模型
    if (!definition) {
      reply = updateCall(reply, call.id, (block) => ({
        ...block,
        status: 'error',
        source: 'browser',
        endedAt: Date.now(),
        progress: '工具不可用',
      }))
      reply = appendResult(reply, {
        type: 'tool_result',
        tool_use_id: call.id,
        content: `工具「${call.name}」当前不可用。可能是 MCP 服务器断开或桌面端未连接，请告知用户检查连接状态，不要重复调用。`,
        isError: true,
        durationMs: Date.now() - startedAt,
      })
      options.update(reply)
      continue
    }

    const awaiting = needsApproval(definition) && !autoApprove
    reply = updateCall(reply, call.id, (block) => ({
      ...block,
      label: definition.label,
      risk: definition.risk,
      source: definition.source,
      status: awaiting ? 'awaiting' : 'running',
      ...(awaiting ? {} : { decision: 'allow' as const }),
    }))
    options.update(reply)

    if (awaiting) {
      const decision: ApprovalDecision = await requestApproval({
        id: `approve-${call.id}`,
        sessionId: options.sessionId,
        toolName: call.name,
        label: definition.label,
        source: definition.source,
        risk: definition.risk,
        input: call.input,
        description: definition.description,
      })
      if (options.signal.aborted) {
        break
      }
      if (decision === 'deny') {
        reply = updateCall(reply, call.id, (block) => ({
          ...block,
          status: 'denied',
          decision: 'deny',
          endedAt: Date.now(),
        }))
        reply = appendResult(reply, {
          type: 'tool_result',
          tool_use_id: call.id,
          content: '用户拒绝执行该操作。请不要重试，改为说明需要用户手动完成，或换一种方式。',
          isError: true,
          durationMs: 0,
        })
        options.update(reply)
        continue
      }
      reply = updateCall(reply, call.id, (block) => ({
        ...block,
        status: 'running',
        decision: 'allow',
      }))
      options.update(reply)
    }

    const running = reply.blocks.find(
      (block): block is ToolCallPart => block.type === 'tool_use' && block.id === call.id
    )
    approved.push({ call: running ?? call, definition })
  }

  /** 单个工具的执行：注册任务、支持转入后台、结果写回消息 */
  const executeOne = async (entry: { call: ToolCallPart; definition: ToolDefinition }) => {
    const { call, definition } = entry
    if (options.signal.aborted) {
      return
    }
    options.onEvent?.('start', call)

    const purpose = readPurpose(call.input) || definition.label
    const task: TaskHandle = startTask({
      sessionId: options.sessionId,
      kind: 'tool',
      toolName: call.name,
      label: definition.label,
      purpose,
      parentSignal: options.signal,
    })

    // 任务 id 先写回工具块，界面在执行中就能提供「后台运行」
    reply = updateCall(reply, call.id, (block) => ({ ...block, taskId: task.id }))
    options.update(reply)

    // 审批等待不计入执行耗时，否则工具卡片会显示成十几秒
    const execStartedAt = Date.now()
    const execution = withTimeout(
      (signal) =>
        runTool(call.name, toArguments(call.input), {
          sessionId: options.sessionId,
          signal,
          progress: (text) => {
            reply = updateCall(reply, call.id, (block) => ({ ...block, progress: text }))
            options.update(reply)
          },
        }),
      task.signal,
      timeoutFor(definition)
    ).then(
      (result): ToolResult => result,
      (error: unknown): ToolResult => {
        const aborted = options.signal.aborted || task.signal.aborted
        return {
          content: aborted
            ? '用户停止了生成，工具调用被中止。'
            : `工具执行超时或被中断：${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        }
      }
    )

    // 等待用户回答的工具有意为之地挂住，不能被自动转后台
    const autoDetach =
      settings.backgroundTools && call.name !== 'ask_user'
        ? window.setTimeout(() => task.detach(), AUTO_DETACH_MS)
        : undefined

    const outcome: RunOutcome = await Promise.race([
      execution,
      task.waitDetach().then(() => DETACHED),
    ]).finally(() => {
      if (autoDetach !== undefined) {
        window.clearTimeout(autoDetach)
      }
    })

    if (isDetached(outcome)) {
      // 转入后台：前台只留一条说明，真正的结果由任务面板查看
      reply = updateCall(reply, call.id, (block) => ({
        ...block,
        status: 'done',
        endedAt: Date.now(),
        progress: undefined,
        detached: true,
      }))
      reply = appendResult(reply, {
        type: 'tool_result',
        tool_use_id: call.id,
        content: `该操作已转入后台执行（任务 ${task.id}），结果稍后可在任务面板查看。不要重复调用同一个工具，先继续回答当前问题。`,
        durationMs: 0,
        meta: { taskId: task.id, detached: true },
      })
      options.update(reply)
      void execution.then((result) => {
        task.finish({ output: result.content, isError: result.isError })
      })
      return
    }

    const result =
      options.signal.aborted && !outcome.isError
        ? { content: '用户停止了生成，工具已中止。', isError: true }
        : outcome
    task.finish({ output: result.content, isError: result.isError })

    reply = updateCall(reply, call.id, (block) => ({
      ...block,
      status: result.isError ? 'error' : 'done',
      endedAt: Date.now(),
      progress: undefined,
    }))
    reply = appendResult(reply, {
      type: 'tool_result',
      tool_use_id: call.id,
      content: clipResult(result.content),
      isError: result.isError,
      artifacts: result.artifacts,
      durationMs: Date.now() - execStartedAt,
      ...(result.meta ? { meta: result.meta } : {}),
      ...(result.images?.length ? { images: result.images } : {}),
    })
    options.update(reply)
    const finished = reply.blocks.find(
      (block): block is ToolCallPart => block.type === 'tool_use' && block.id === call.id
    )
    if (finished) {
      options.onEvent?.('finish', finished)
    }
  }

  // 并行度 1 等价于原来的顺序执行
  const limit = Math.max(1, settings.parallelTools)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, approved.length) }, async () => {
    while (cursor < approved.length) {
      const entry = approved[cursor]
      cursor += 1
      if (options.signal.aborted) {
        return
      }
      await executeOne(entry)
    }
  })
  await Promise.all(workers)
  return reply
}

/** 模型可能把参数写成字符串，统一成对象再交给工具；purpose 只用于展示，执行前剥离 */
const toArguments = (input: unknown): Record<string, unknown> => {
  const strip = (value: Record<string, unknown>) => {
    if (!Object.hasOwn(value, 'purpose')) {
      return value
    }
    const next = { ...value }
    delete next.purpose
    return next
  }
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    return strip(input as Record<string, unknown>)
  }
  if (typeof input === 'string' && input.trim()) {
    try {
      const parsed: unknown = JSON.parse(input)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return strip(parsed as Record<string, unknown>)
      }
    } catch {
      return {}
    }
  }
  return {}
}

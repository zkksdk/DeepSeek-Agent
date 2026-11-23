import { streamMessage } from '../api/client.js'
import type {
  ClientToolDefinition,
  CreateMessageRequest,
  MessageParam,
  ToolUseBlock,
} from '../api/types.js'
import type { MessageStreamEvent } from '../api/types.js'
import { useSettings } from '../settings.js'
import { defaultSystemPrompt, TOOL_PURPOSE_PROMPT } from '../systemPrompt.js'
import { clipText } from '../../utils/format.js'
import { mockStreamMessage } from './mock.js'
import { listTools, runTool } from './registry.js'
import { needsApproval } from './types.js'

/** 子 Agent 固定用轻量模型，避免主对话的模型选择影响成本 */
const SUBAGENT_MODEL = 'deepseek-flash'
/** 回传给主 Agent 的结果上限 */
const MAX_REPORT = 6000
/** 单个子 Agent 最多带多少个工具，太多会稀释注意力 */
const MAX_TOOLS = 10
/** 子 Agent 不暴露编排类工具，避免递归；也不允许反问用户，卡住时只能自己决定 */
const EXCLUDED = new Set([
  'spawn_subagent',
  // 目标由用户与主 Agent 维护，子 Agent 不该改动
  'manage_goals',
  'show_widget',
  'ask_user',
  'workspace_write_file',
  'workspace_switch_branch',
])

const SYSTEM_PROMPT = [
  '你是主 Agent 派生出的子 Agent，只负责完成交给你的子任务。',
  '要求：',
  '- 不要询问用户，不要寒暄，不要复述任务。',
  '- 能用手上的工具验证的，先调用工具再下结论；只读工具可以连续调用。',
  '- 输出结论、关键依据与不确定性，控制在 600 字以内。',
  '- 如果任务无法完成，直接说明缺什么，不要编造。',
].join('\n')

type Collected = {
  text: string
  calls: ToolUseBlock[]
  stopReason: string | null
}

/** 把一轮事件流收成文本与工具调用 */
const collect = async (events: AsyncGenerator<MessageStreamEvent>): Promise<Collected> => {
  let text = ''
  let stopReason: string | null = null
  const calls: ToolUseBlock[] = []
  const pending = new Map<number, { id: string; name: string; json: string }>()
  for await (const event of events) {
    if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
      pending.set(event.index, {
        id: event.content_block.id,
        name: event.content_block.name,
        json: '',
      })
      continue
    }
    if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') {
        text += event.delta.text
      } else if (event.delta.type === 'input_json_delta') {
        const slot = pending.get(event.index)
        if (slot) {
          slot.json += event.delta.partial_json
        }
      }
      continue
    }
    if (event.type === 'content_block_stop') {
      const slot = pending.get(event.index)
      if (slot) {
        let input: unknown = {}
        try {
          input = slot.json ? JSON.parse(slot.json) : {}
        } catch {
          input = {}
        }
        calls.push({ type: 'tool_use', id: slot.id, name: slot.name, input })
        pending.delete(event.index)
      }
      continue
    }
    if (event.type === 'message_delta') {
      stopReason = event.delta.stop_reason
    }
  }
  return { text, calls, stopReason }
}

const toDeclaration = (definition: ReturnType<typeof listTools>[number]): ClientToolDefinition => {
  const schema = definition.inputSchema as Record<string, unknown>
  return {
    name: definition.name,
    description: `${definition.description}\n\n[来源：${definition.source}]`,
    input_schema: {
      ...schema,
      type: 'object',
      properties:
        typeof schema.properties === 'object' && schema.properties !== null ? schema.properties : {},
    } as ClientToolDefinition['input_schema'],
  }
}

/** 按白名单或默认只读集合挑选工具 */
const pickTools = (names?: string[]) => {
  const available = listTools().filter((definition) => !EXCLUDED.has(definition.name))
  if (names && names.length > 0) {
    const wanted = new Set(names)
    return available.filter((definition) => wanted.has(definition.name)).slice(0, MAX_TOOLS)
  }
  // 默认只给不需要审批的只读工具，子 Agent 不会打断用户
  return available.filter((definition) => !needsApproval(definition)).slice(0, MAX_TOOLS)
}

export type SubagentInput = {
  task: string
  tools?: string[]
  maxRounds: number
  sessionId: string
  signal: AbortSignal
  onProgress: (text: string) => void
}

export type SubagentResult = {
  text: string
  rounds: number
  used: string[]
  toolCalls: number
}

/**
 * 运行一个子 Agent：独立上下文、限定工具、最多若干轮。
 * 工具结果不会进入主对话，只把最终结论回传给主 Agent。
 */
export const runSubagent = async (input: SubagentInput): Promise<SubagentResult> => {
  const settings = useSettings.getState()
  const picked = pickTools(input.tools)
  const declarations = picked.map(toDeclaration)
  const messages: MessageParam[] = [{ role: 'user', content: input.task }]
  const used: string[] = []
  let toolCalls = 0
  let report = ''
  let rounds = 0

  for (let round = 1; round <= input.maxRounds; round += 1) {
    if (input.signal.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    rounds = round
    input.onProgress(`子 Agent 第 ${round} 轮推理`)
    const shared = settings.systemPrompt.trim()
    // 默认提示词只属于主对话，不必整段塞给子 Agent；用户改过才共享
    const custom = shared && shared !== defaultSystemPrompt() ? shared : ''
    const body: CreateMessageRequest = {
      model: SUBAGENT_MODEL,
      // 子 Agent 保留自己的职责说明，同时继承用户的自定义风格
      system: [SYSTEM_PROMPT, TOOL_PURPOSE_PROMPT, custom].filter(Boolean).join('\n\n'),
      messages,
      thinking: { type: 'disabled' },
      // 子 Agent 沿用主对话的采样参数，保持输出风格一致
      ...(settings.temperature !== null ? { temperature: settings.temperature } : {}),
      ...(settings.topP !== null ? { top_p: settings.topP } : {}),
      safety_check: { level: 'high' },
      tools: declarations,
    }
    const events = settings.mockAgent
      ? mockStreamMessage(body, input.signal)
      : streamMessage(settings.apiKey ?? '', body, input.signal)
    const { text, calls } = await collect(events)
    report = text.trim() || report
    if (calls.length === 0) {
      return { text: report, rounds, used, toolCalls }
    }

    messages.push({
      role: 'assistant',
      content: [
        ...(text.trim() ? [{ type: 'text' as const, text: text.trim() }] : []),
        ...calls.map((call) => ({ ...call, input: call.input ?? {} })),
      ],
    })

    const results = []
    for (const call of calls) {
      const args =
        typeof call.input === 'object' && call.input !== null
          ? (call.input as Record<string, unknown>)
          : {}
      input.onProgress(`子 Agent 调用 ${call.name}`)
      used.push(call.name)
      toolCalls += 1
      const result = await runTool(call.name, args, {
        sessionId: input.sessionId,
        signal: input.signal,
        progress: () => {},
      })
      results.push({
        type: 'tool_result' as const,
        tool_use_id: call.id,
        content: clipText(result.content, MAX_REPORT),
        is_error: result.isError === true,
      })
    }
    messages.push({ role: 'user', content: results })
  }

  return { text: report, rounds, used, toolCalls }
}

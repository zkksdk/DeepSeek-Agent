import { registerTool, unregisterTools } from '../registry.js'
import { defineTool, fail, objectSchema, ok, str } from '../toolKit.js'
import type { JsonSchema } from '../../api/types.js'
import type { RegisteredTool, ToolContext, ToolResult } from '../types.js'
import { runTool } from '../registry.js'

/**
 * Agent 自建工具：把已有的几个工具串成一条固定流程，注册成新工具。
 * 只做「编排」，不生成可执行代码，所以模型无法借这条路绕过审批或沙箱。
 */

export type CustomToolParam = {
  name: string
  type: 'string' | 'number' | 'boolean'
  description?: string
  required?: boolean
}

export type CustomToolStep = {
  tool: string
  /** 值里可以用 {{参数名}} 引用本次调用的参数 */
  input?: Record<string, unknown>
}

export type CustomToolSpec = {
  name: string
  label: string
  description: string
  params: CustomToolParam[]
  steps: CustomToolStep[]
  createdAt: number
}

const STORAGE_KEY = 'chat-agent:custom-tools'
const MAX_STEPS = 8
const MAX_TOOLS = 20
const NAME_RULE = /^[a-z][a-z0-9_]{2,40}$/

const load = (): CustomToolSpec[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isSpec) : []
  } catch {
    return []
  }
}

const isSpec = (value: unknown): value is CustomToolSpec => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    typeof record.name === 'string' &&
    typeof record.label === 'string' &&
    typeof record.description === 'string' &&
    Array.isArray(record.steps)
  )
}

const persist = (specs: CustomToolSpec[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(specs))
  } catch {
    // 存储不可用时只在当前会话生效
  }
}

const specs = new Map<string, CustomToolSpec>(load().map((spec) => [spec.name, spec]))

const save = () => persist([...specs.values()])

/** 把 {{name}} 占位替换成本次调用的参数值；支持嵌套对象与数组 */
const interpolate = (value: unknown, args: Record<string, unknown>): unknown => {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (placeholder, key: string) => {
      const arg = args[key]
      return arg === undefined || arg === null ? placeholder : String(arg)
    })
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolate(item, args))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        interpolate(item, args),
      ])
    )
  }
  return value
}

const buildSchema = (params: CustomToolParam[]): JsonSchema => ({
  type: 'object',
  properties: Object.fromEntries(
    params.map((param) => [
      param.name,
      { type: param.type, ...(param.description ? { description: param.description } : {}) },
    ])
  ),
  required: params.filter((param) => param.required !== false).map((param) => param.name),
  additionalProperties: false,
})

const toRegistered = (spec: CustomToolSpec): RegisteredTool =>
  defineTool(
    {
      name: spec.name,
      label: spec.label,
      description: `${spec.description}\n\n（这是之前由 Agent 组合出来的工具，按顺序调用：${spec.steps
        .map((step) => step.tool)
        .join(' → ')}）`,
      inputSchema: buildSchema(spec.params),
      risk: 'safe',
      icon: 'bolt',
    },
    async (input, context: ToolContext): Promise<ToolResult> => {
      const outputs: string[] = []
      for (const [index, step] of spec.steps.entries()) {
        if (context.signal.aborted) {
          return fail('已停止')
        }
        context.progress(`第 ${index + 1}/${spec.steps.length} 步：${step.tool}`)
        const args = (interpolate(step.input ?? {}, input) ?? {}) as Record<string, unknown>
        const result = await runTool(step.tool, args, context)
        outputs.push(`### ${index + 1}. ${step.tool}\n${result.content}`)
        // 某一步失败就停下：后续步骤通常依赖它的输出
        if (result.isError) {
          return {
            content: `${outputs.join('\n\n')}\n\n组合工具在第 ${index + 1} 步失败，已停止。`,
            isError: true,
          }
        }
      }
      return ok(`组合工具「${spec.label}」执行完成：\n\n${outputs.join('\n\n')}`, {
        meta: { steps: spec.steps.length },
      })
    },
    'browser'
  )

/** 注册一个自建工具；同名或与内置工具冲突时返回错误 */
export const addCustomTool = (spec: CustomToolSpec): { ok: boolean; error?: string } => {
  if (!NAME_RULE.test(spec.name)) {
    return { ok: false, error: 'name 只能用小写字母、数字和下划线，3-41 个字符，且以字母开头' }
  }
  if (specs.has(spec.name)) {
    return { ok: false, error: `已存在同名工具：${spec.name}` }
  }
  if (specs.size >= MAX_TOOLS) {
    return { ok: false, error: `自建工具最多 ${MAX_TOOLS} 个，请先删除不用的` }
  }
  if (spec.steps.length === 0 || spec.steps.length > MAX_STEPS) {
    return { ok: false, error: `steps 需要 1-${MAX_STEPS} 个` }
  }
  if (spec.steps.some((step) => step.tool === spec.name)) {
    return { ok: false, error: 'step 不能引用自己' }
  }
  specs.set(spec.name, spec)
  save()
  registerTool(toRegistered(spec))
  return { ok: true }
}

export const removeCustomTool = (name: string) => {
  if (!specs.delete(name)) {
    return false
  }
  save()
  unregisterTools((definition) => definition.name === name)
  return true
}

export const listCustomTools = () => [...specs.values()]

/** 启动时把保存的自建工具重新注册回来 */
export const registerCustomTools = () => {
  for (const spec of specs.values()) {
    registerTool(toRegistered(spec))
  }
}

const readParams = (input: Record<string, unknown>): CustomToolParam[] => {
  if (!Array.isArray(input.params)) {
    return []
  }
  return input.params.flatMap((item): CustomToolParam[] => {
    if (!item || typeof item !== 'object') {
      return []
    }
    const record = item as Record<string, unknown>
    const name = str(record, 'name').trim()
    if (!/^\w{1,40}$/.test(name)) {
      return []
    }
    const type =
      record.type === 'number' || record.type === 'boolean' ? record.type : ('string' as const)
    return [
      {
        name,
        type,
        description: str(record, 'description') || undefined,
        required: record.required !== false,
      },
    ]
  })
}

const readSteps = (input: Record<string, unknown>): CustomToolStep[] => {
  if (!Array.isArray(input.steps)) {
    return []
  }
  return input.steps.flatMap((item): CustomToolStep[] => {
    if (!item || typeof item !== 'object') {
      return []
    }
    const record = item as Record<string, unknown>
    const tool = str(record, 'tool').trim()
    if (!tool) {
      return []
    }
    const raw = record.input
    return [
      {
        tool,
        input:
          raw && typeof raw === 'object' && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : {},
      },
    ]
  })
}

const createToolDefinition = defineTool(
  {
    name: 'create_tool',
    label: '创建工具',
    description: [
      '把已有工具组合成一个新工具，后续可以像内置工具一样直接调用。',
      '只做编排：steps 里按顺序列出要调用的工具名与参数，参数值可以用 {{参数名}} 引用本工具自己的入参。',
      '适合重复出现的多步流程，例如「先列变更再逐文件看 diff」「先搜索再抓取前三条结果」。',
      '不能生成或执行任意代码；需要新能力时请改用桌面端 shell / python 工具。',
    ].join(''),
    inputSchema: objectSchema(
      {
        name: { type: 'string', description: '工具名，小写字母开头，可含数字与下划线' },
        label: { type: 'string', description: '展示名，例如「仓库体检」' },
        description: { type: 'string', description: '工具用途说明，会作为工具描述给模型看' },
        params: {
          type: 'array',
          description: '入参定义',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: ['string', 'number', 'boolean'] },
              description: { type: 'string' },
              required: { type: 'boolean' },
            },
            required: ['name'],
          },
        },
        steps: {
          type: 'array',
          description: '按顺序执行的步骤',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', description: '已注册的工具名' },
              input: { type: 'object', description: '该工具的参数，可含 {{参数名}} 占位' },
            },
            required: ['tool'],
          },
        },
      },
      ['name', 'label', 'description', 'steps']
    ),
    risk: 'write',
    requiresApproval: true,
    icon: 'bolt',
  },
  async (input) => {
    const spec: CustomToolSpec = {
      name: str(input, 'name').trim(),
      label: str(input, 'label').trim() || str(input, 'name').trim(),
      description: str(input, 'description').trim(),
      params: readParams(input),
      steps: readSteps(input),
      createdAt: Date.now(),
    }
    const result = addCustomTool(spec)
    if (!result.ok) {
      return fail(result.error ?? '创建失败')
    }
    return ok(
      `已创建工具 ${spec.name}（${spec.steps.length} 步：${spec.steps
        .map((step) => step.tool)
        .join(' → ')}）。现在可以直接调用它。`,
      { meta: { tool: spec.name } }
    )
  },
  'browser'
)

const deleteToolDefinition = defineTool(
  {
    name: 'delete_tool',
    label: '删除工具',
    description: '删除一个之前由 Agent 创建的组合工具。内置工具不受影响。',
    inputSchema: objectSchema({ name: { type: 'string', description: '工具名' } }, ['name']),
    risk: 'write',
    requiresApproval: true,
    icon: 'trash',
  },
  async (input) => {
    const name = str(input, 'name').trim()
    return removeCustomTool(name) ? ok(`已删除工具 ${name}`) : fail(`没有这个自建工具：${name}`)
  },
  'browser'
)

export const customToolTools: RegisteredTool[] = [createToolDefinition, deleteToolDefinition]

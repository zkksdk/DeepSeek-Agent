import type { JsonSchema } from '../api/types.js'
import { clipText } from '../../utils/format.js'
import type { RegisteredTool, ToolDefinition, ToolResult } from './types.js'

type DefineInput = {
  name: string
  label: string
  description: string
  inputSchema: JsonSchema
  risk?: ToolDefinition['risk']
  requiresApproval?: boolean
  icon?: string
  timeoutMs?: number
}

export const defineTool = (
  input: DefineInput,
  execute: RegisteredTool['execute'],
  source: ToolDefinition['source'] = 'browser',
  server?: { id: string; name: string }
): RegisteredTool => ({
  definition: {
    name: input.name,
    label: input.label,
    description: input.description,
    inputSchema: input.inputSchema,
    risk: input.risk ?? 'safe',
    requiresApproval: input.requiresApproval,
    icon: input.icon,
    timeoutMs: input.timeoutMs,
    source,
    serverId: server?.id,
    serverName: server?.name,
  },
  execute,
})

/** 读取字符串参数，带默认值 */
export const str = (input: Record<string, unknown>, key: string, fallback = ''): string => {
  const value = input[key]
  return typeof value === 'string' ? value : fallback
}

export const num = (input: Record<string, unknown>, key: string): number | undefined => {
  const value = input[key]
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return undefined
}

export const bool = (input: Record<string, unknown>, key: string): boolean => input[key] === true

export const ok = (content: string, extra?: Partial<ToolResult>): ToolResult => ({
  content,
  ...extra,
})

export const fail = (content: string): ToolResult => ({ content, isError: true })

/** 截断过长文本，避免工具结果吃掉上下文；按代理对边界切，不产生半个 emoji */
export const clip = (text: string, max: number) =>
  text.length <= max ? text : `${clipText(text, max)}\n\n…（已截断，共 ${text.length} 字符）`

export const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = []
): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

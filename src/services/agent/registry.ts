import type {
  RegisteredTool,
  ToolDefinition,
  ToolExecutor,
  ToolResult,
  ToolSource,
} from './types.js'

/**
 * 工具注册表：浏览器内置工具、桌面端桥、扩展桥与 MCP 工具统一注册到这里。
 * 模型只看到 definition；执行由 execute 完成。
 */
const tools = new Map<string, RegisteredTool>()
const listeners = new Set<() => void>()
let revision = 0

const notify = () => {
  revision += 1
  for (const listener of listeners) {
    listener()
  }
}

export const registerTool = (tool: RegisteredTool) => {
  tools.set(tool.definition.name, tool)
  notify()
}

export const registerTools = (list: RegisteredTool[]) => {
  for (const tool of list) {
    tools.set(tool.definition.name, tool)
  }
  if (list.length > 0) {
    notify()
  }
}

/** 移除某个来源（或某个 MCP 服务器）的全部工具 */
export const unregisterTools = (predicate: (definition: ToolDefinition) => boolean) => {
  let changed = false
  for (const [name, tool] of tools) {
    if (predicate(tool.definition)) {
      tools.delete(name)
      changed = true
    }
  }
  if (changed) {
    notify()
  }
}

export const unregisterBySource = (source: ToolSource, serverId?: string) =>
  unregisterTools(
    (definition) =>
      definition.source === source && (serverId === undefined || definition.serverId === serverId)
  )

export const getTool = (name: string) => tools.get(name)

export const listTools = (): ToolDefinition[] =>
  [...tools.values()].map((tool) => tool.definition)

export const listToolsBySource = (source: ToolSource) =>
  listTools().filter((definition) => definition.source === source)

/** 供 useSyncExternalStore 使用 */
export const subscribeTools = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const getToolsRevision = () => revision

/** 执行结果统一收口：异常转成 is_error，保证模型总能拿到一条结果 */
export const runTool = async (
  name: string,
  input: Record<string, unknown>,
  executeArgs: Parameters<ToolExecutor>[1]
): Promise<ToolResult> => {
  const tool = tools.get(name)
  if (!tool) {
    return {
      content: `工具 ${name} 不存在或已断开。请改用其他工具，或告知用户当前连接状态。`,
      isError: true,
    }
  }
  try {
    return await tool.execute(input, executeArgs)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { content: `工具执行失败：${message}`, isError: true }
  }
}

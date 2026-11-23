/**
 * 智能体工具注册表：基于插件内核收集与路由。
 * 对外只暴露两个函数，store 层无需关心插件来源（内置/技能/MCP）。
 */
import type { ClientToolDefinition } from '../api/types.js'
import type { ToolRunResult } from './tools.js'
import { buildPlugins } from './plugin.js'

/** 收集外部工具定义（技能 + MCP；内置工具由 store 单独控制启停） */
export const collectExternalTools = async (): Promise<ClientToolDefinition[]> => {
  const plugins = await buildPlugins()
  return plugins
    .filter((plugin) => plugin.source !== 'builtin' && plugin.enabled())
    .flatMap((plugin) => plugin.tools())
}

/** 执行任意工具：按插件内核路由，未命中返回未知工具 */
export const runAnyTool = async (
  name: string,
  input: unknown,
  signal?: AbortSignal
): Promise<ToolRunResult> => {
  const plugins = await buildPlugins()
  for (const plugin of plugins) {
    if (!plugin.enabled()) {
      continue
    }
    if (!plugin.tools().some((tool) => tool.name === name)) {
      continue
    }
    const result = await plugin.invoke(name, input, signal)
    if (result) {
      return result
    }
  }
  return { content: `未知工具：${name}`, isError: true }
}

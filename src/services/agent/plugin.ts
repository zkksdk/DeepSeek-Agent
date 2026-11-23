/**
 * 插件内核：把「内置工具 / 自定义技能 / MCP 服务器 / 多智能体」统一成 AgentPlugin。
 *
 * 设计取舍：
 * - 保留函数式构建（每次收集时组装插件列表），避免常驻注册表与热更新不一致；
 * - 插件只负责「暴露哪些工具 + 怎么执行」，UI 仍由宿主渲染（声明式，不做动态界面加载）；
 * - store 层只依赖 registry 的两个函数，内核替换不影响业务代码。
 */
import type { ClientToolDefinition } from '../api/types.js'
import { AGENT_TOOLS, runTool, type ToolRunResult } from './tools.js'
import { callMcpTool, getMcpTools, type McpTool } from './mcp.js'
import {
  readHttpSkills,
  runHttpSkill,
  skillToDefinition,
  skillToolName,
  type HttpSkill,
} from './skills.js'
import { readMcpServers } from './mcp.js'
import { useSettings } from '../settings.js'

export type PluginSource = 'builtin' | 'skill' | 'mcp' | 'agent'

export type AgentPlugin = {
  id: string
  name: string
  description: string
  source: PluginSource
  /** 是否启用（内置工具受 toolOverrides 控制；技能/MCP 受自身 enabled 控制） */
  enabled: () => boolean
  /** 暴露给模型的工具定义 */
  tools: () => ClientToolDefinition[]
  /** 执行工具；不属于本插件时返回 null */
  invoke: (toolName: string, input: unknown, signal?: AbortSignal) => Promise<ToolRunResult | null>
}

/** 内置工具插件（时间/计算/文本/JSON/随机数/位置/网页/自举/多智能体） */
const builtinPlugin = (): AgentPlugin => {
  const overrides = useSettings.getState().toolOverrides
  return {
    id: 'builtin',
    name: '内置工具',
    description: '时间、计算、文本统计、JSON、随机数、定位、网页读取、自举与多智能体',
    source: 'builtin',
    enabled: () => true,
    tools: () => AGENT_TOOLS.filter((tool) => overrides[tool.name] !== false),
    invoke: async (toolName, input, signal) =>
      AGENT_TOOLS.some((tool) => tool.name === toolName)
        ? runTool(toolName, input, signal)
        : null,
  }
}

/** 单个 HTTP 技能插件 */
const skillPlugin = (skill: HttpSkill): AgentPlugin => {
  const toolName = skillToolName(skill)
  return {
    id: `skill:${skill.id}`,
    name: skill.name,
    description: skill.description,
    source: 'skill',
    enabled: () => skill.enabled,
    tools: () => [skillToDefinition(skill)],
    invoke: async (name, input, signal) =>
      name === toolName ? runHttpSkill(skill, input, signal) : null,
  }
}

/** 单个 MCP 服务器插件（其下所有工具） */
const mcpPlugin = (serverId: string, tools: McpTool[]): AgentPlugin => {
  const server = readMcpServers().find((item) => item.id === serverId)
  return {
    id: `mcp:${serverId}`,
    name: server?.name ?? 'MCP 服务器',
    description: server?.url ?? '',
    source: 'mcp',
    enabled: () => server?.enabled !== false,
    tools: () => tools.map((tool) => tool.definition),
    invoke: async (name, input, signal) =>
      tools.some((tool) => tool.exposedName === name)
        ? callMcpTool(name, input, signal)
        : null,
  }
}

/** 组装当前所有插件（异步：MCP 需要连接/缓存） */
export const buildPlugins = async (): Promise<AgentPlugin[]> => {
  const plugins: AgentPlugin[] = [builtinPlugin()]
  for (const skill of readHttpSkills()) {
    plugins.push(skillPlugin(skill))
  }
  try {
    const mcpTools = await getMcpTools()
    const grouped = new Map<string, McpTool[]>()
    for (const tool of mcpTools) {
      const list = grouped.get(tool.serverId) ?? []
      list.push(tool)
      grouped.set(tool.serverId, list)
    }
    for (const [serverId, tools] of grouped) {
      plugins.push(mcpPlugin(serverId, tools))
    }
  } catch {
    // MCP 全部不可用时只保留其他插件
  }
  return plugins
}

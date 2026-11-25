import { registerTools } from './registry.js'
import { browserTools } from './tools/browserTools.js'
import { utilityTools } from './tools/utilityTools.js'
import { widgetTools } from './tools/widgetTools.js'
import { agentTools } from './tools/agentTools.js'
import { askUserTools } from './tools/askUserTool.js'
import { workspaceTools } from './tools/workspaceTools.js'
import { customToolTools, registerCustomTools } from './tools/customTools.js'
import { memoryTools } from './tools/memoryTools.js'
import { initExtensionBridge } from './extension.js'
import { initDesktop } from './desktop/store.js'
import { connectEnabledServers } from './mcp/store.js'

let started = false

/**
 * 初始化 agent 能力：内置工具、扩展桥、桌面连接、MCP 服务器。
 * 全部失败也不影响聊天本身。
 */
export const initAgent = () => {
  if (started) {
    return
  }
  started = true
  registerTools([
    ...browserTools,
    ...utilityTools,
    ...widgetTools,
    ...agentTools,
    ...askUserTools,
    ...workspaceTools,
    ...customToolTools,
    ...memoryTools,
  ])
  // 上次创建的组合工具跟着回来
  registerCustomTools()
  initExtensionBridge()
  initDesktop()
  void connectEnabledServers()
}

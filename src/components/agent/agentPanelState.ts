import { create } from 'zustand'

export type AgentPanelTab = 'tools' | 'mcp' | 'connect'

type AgentPanelState = {
  open: boolean
  tab: AgentPanelTab
}

export const useAgentPanel = create<AgentPanelState>(() => ({ open: false, tab: 'tools' }))

export const openAgentPanel = (tab: AgentPanelTab = 'tools') =>
  useAgentPanel.setState({ open: true, tab })

export const closeAgentPanel = () => useAgentPanel.setState({ open: false })

export const setAgentPanelTab = (tab: AgentPanelTab) => useAgentPanel.setState({ tab })

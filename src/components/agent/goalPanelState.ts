import { create } from 'zustand'

/** 目标面板的开合状态；按钮在输入框右侧 */
type GoalPanelState = { open: boolean }

export const useGoalPanel = create<GoalPanelState>(() => ({ open: false }))

export const openGoalPanel = () => useGoalPanel.setState({ open: true })
export const closeGoalPanel = () => useGoalPanel.setState({ open: false })
export const toggleGoalPanel = () => useGoalPanel.setState((state) => ({ open: !state.open }))

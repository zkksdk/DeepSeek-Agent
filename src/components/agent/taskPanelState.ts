import { create } from 'zustand'

/** 任务面板的开合状态；触发按钮在输入框右侧 */
type TaskPanelState = { open: boolean }

export const useTaskPanel = create<TaskPanelState>(() => ({ open: false }))

export const openTaskPanel = () => useTaskPanel.setState({ open: true })
export const closeTaskPanel = () => useTaskPanel.setState({ open: false })
export const toggleTaskPanel = () => useTaskPanel.setState((state) => ({ open: !state.open }))

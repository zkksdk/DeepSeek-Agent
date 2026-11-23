import { create } from 'zustand'

/** 右侧轨迹面板开合状态（会话级共享） */
export const useTrajectoryPanel = create<{ open: boolean }>(() => ({ open: false }))

export const toggleTrajectoryPanel = () =>
  useTrajectoryPanel.setState((state) => ({ open: !state.open }))

export const closeTrajectoryPanel = () => useTrajectoryPanel.setState({ open: false })

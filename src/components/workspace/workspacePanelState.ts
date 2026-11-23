import { create } from 'zustand'
import { initWorkspace } from '../../services/workspace/store.js'

type WorkspacePanelState = {
  open: boolean
  /** 打开时希望定位到的文件；工具卡片点击改动行数时用它跳到对应 diff */
  focusPath: string | null
}

export const useWorkspacePanel = create<WorkspacePanelState>(() => ({
  open: false,
  focusPath: null,
}))

export const openWorkspacePanel = () => {
  initWorkspace()
  useWorkspacePanel.setState({ open: true })
}

/** 打开工作区并选中某个文件（工具卡片上的 +N −M 走这里） */
export const openWorkspaceFile = (path: string) => {
  initWorkspace()
  useWorkspacePanel.setState({ open: true, focusPath: path })
}

/** 面板消费掉定位请求，后续用户手动切换不再被覆盖 */
export const consumeWorkspaceFocus = () => useWorkspacePanel.setState({ focusPath: null })

export const closeWorkspacePanel = () =>
  useWorkspacePanel.setState({ open: false, focusPath: null })

/**
 * 工作区：把会话分组管理。工作区列表与当前选中项存 localStorage，
 * 会话通过 Session.workspaceId 归属到工作区（缺失视为默认工作区）。
 */
import { create } from 'zustand'
import { storage } from '../platform/storage.js'

export type Workspace = { id: string; name: string; createdAt: number }

export const DEFAULT_WORKSPACE_ID = 'default'

const STORAGE_KEY = 'chat-demo:workspaces'
const ACTIVE_KEY = 'chat-demo:active-workspace'

const defaultWorkspace = (): Workspace => ({
  id: DEFAULT_WORKSPACE_ID,
  name: '默认工作区',
  createdAt: 0,
})

const readWorkspaces = (): Workspace[] => {
  const base = [defaultWorkspace()]
  const raw = storage.getJSON<unknown>(STORAGE_KEY, null)
  if (!Array.isArray(raw)) {
    return base
  }
  const extra = raw
      .filter(
        (item): item is Workspace =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as Workspace).id === 'string' &&
          typeof (item as Workspace).name === 'string' &&
          (item as Workspace).id !== DEFAULT_WORKSPACE_ID
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
      }))
  return [...base, ...extra]
}

const readActive = (workspaces: Workspace[]): string => {
  const saved = storage.get(ACTIVE_KEY)
  if (saved && workspaces.some((workspace) => workspace.id === saved)) {
    return saved
  }
  return DEFAULT_WORKSPACE_ID
}

type WorkspaceState = { workspaces: Workspace[]; activeId: string }

const initialWorkspaces = readWorkspaces()

export const useWorkspaces = create<WorkspaceState>(() => ({
  workspaces: initialWorkspaces,
  activeId: readActive(initialWorkspaces),
}))

const persist = (workspaces: Workspace[], activeId: string) => {
  const extra = workspaces.filter((workspace) => workspace.id !== DEFAULT_WORKSPACE_ID)
  storage.setJSON(STORAGE_KEY, extra)
  storage.set(ACTIVE_KEY, activeId)
}

export const createWorkspace = (name: string): Workspace | null => {
  const trimmed = name.trim()
  if (!trimmed) {
    return null
  }
  const workspace: Workspace = {
    id: `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed.slice(0, 40),
    createdAt: Date.now(),
  }
  const { workspaces } = useWorkspaces.getState()
  const next = [...workspaces, workspace]
  persist(next, workspace.id)
  useWorkspaces.setState({ workspaces: next, activeId: workspace.id })
  return workspace
}

export const renameWorkspace = (id: string, name: string) => {
  const trimmed = name.trim()
  if (!trimmed) {
    return
  }
  const { workspaces, activeId } = useWorkspaces.getState()
  const next = workspaces.map((workspace) =>
    workspace.id === id ? { ...workspace, name: trimmed.slice(0, 40) } : workspace
  )
  persist(next, activeId)
  useWorkspaces.setState({ workspaces: next })
}

/** 删除工作区；默认工作区不可删除，会话的归属处理由调用方负责 */
export const removeWorkspace = (id: string) => {
  if (id === DEFAULT_WORKSPACE_ID) {
    return
  }
  const { workspaces, activeId } = useWorkspaces.getState()
  const next = workspaces.filter((workspace) => workspace.id !== id)
  const nextActive = activeId === id ? DEFAULT_WORKSPACE_ID : activeId
  persist(next, nextActive)
  useWorkspaces.setState({ workspaces: next, activeId: nextActive })
}

export const setActiveWorkspace = (id: string) => {
  const { workspaces } = useWorkspaces.getState()
  if (!workspaces.some((workspace) => workspace.id === id)) {
    return
  }
  persist(workspaces, id)
  useWorkspaces.setState({ activeId: id })
}

/** 会话所属工作区（缺失视为默认） */
export const workspaceOf = (workspaceId?: string): string =>
  workspaceId ?? DEFAULT_WORKSPACE_ID

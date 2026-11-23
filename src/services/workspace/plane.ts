import { create } from 'zustand'

/**
 * 输入框旁的工作区选择器有两个平面：网页里的工作区（演示仓库 / 本地文件夹）和
 * 桌面端桥接的本机工作区。
 *
 * 之前没有记录「用户到底选了哪个平面」，只要桌面端连着，选择器就无条件显示桌面端的当前目录，
 * 于是永远显示成 .agentdesk 这类配置目录，网页工作区等于白选。这里把选择显式存下来。
 */
export type WorkspacePlane = { kind: 'web' } | { kind: 'desktop'; path: string }

const KEY = 'chat-agent:workspace-plane'

const read = (): WorkspacePlane => {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WorkspacePlane> & { path?: string }
      if (parsed.kind === 'desktop' && typeof parsed.path === 'string' && parsed.path) {
        return { kind: 'desktop', path: parsed.path }
      }
    }
  } catch {
    // 存储不可用时退回网页工作区
  }
  return { kind: 'web' }
}

const persist = (plane: WorkspacePlane) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(plane))
  } catch {
    // 只影响下次打开时的默认选择
  }
}

const initial = read()

export const useWorkspacePlane = create<WorkspacePlane>(() => initial)

export const setWebPlane = () => {
  persist({ kind: 'web' })
  useWorkspacePlane.setState({ kind: 'web' })
}

export const setDesktopPlane = (path: string) => {
  persist({ kind: 'desktop', path })
  useWorkspacePlane.setState({ kind: 'desktop', path })
}

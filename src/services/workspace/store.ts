import { create } from 'zustand'
import { demoWorkspace } from './demo.js'
import { diffWorkspace } from './diff.js'
import { deleteHandle, ensurePermission, loadHandle, saveHandle } from './handles.js'
import {
  canPickDirectoryViaShell,
  canWriteViaShell,
  pickDirectory,
  pickFolderViaShell,
  readLocalWorkspace,
  refreshFolderViaShell,
  writeFileViaShell,
  canTransferViaShell,
  exportViaShell,
  importViaShell,
} from './local.js'
import type { WorkspaceSnapshot, WorkspaceSource } from './types.js'

export type BranchData = {
  head: Record<string, string>
  worktree: Record<string, string>
}

type DemoState = {
  branch: string
  branchData: Record<string, BranchData>
}

const STORAGE_KEY = 'deepseek-agent:workspace'
const STORAGE_VERSION = 2
const LIST_KEY = 'deepseek-agent:workspaces'
const DEMO_ID = 'demo'

const seed = (): DemoState => {
  const workspace = demoWorkspace()
  return { branch: workspace.branch, branchData: workspace.branchData }
}

const loadDemo = (): DemoState => {
  const fallback = seed()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return fallback
    }
    const saved = JSON.parse(raw) as { version?: number; branch?: string; branchData?: unknown }
    if (typeof saved.branch !== 'string') {
      return fallback
    }
    const data = saved.branchData as Record<string, BranchData> | undefined
    if (!data || typeof data !== 'object') {
      return fallback
    }
    const branchData: Record<string, BranchData> = {}
    for (const [name, value] of Object.entries(data)) {
      if (
        value &&
        typeof value.head === 'object' &&
        typeof value.worktree === 'object' &&
        value.head !== null &&
        value.worktree !== null
      ) {
        branchData[name] = { head: value.head, worktree: value.worktree }
      }
    }
    if (!branchData[saved.branch]) {
      return fallback
    }
    // 代码里新增的演示分支要合并进来，避免旧缓存挡住
    for (const [name, value] of Object.entries(fallback.branchData)) {
      branchData[name] ??= value
    }
    return { branch: saved.branch, branchData }
  } catch {
    return fallback
  }
}

let demo = loadDemo()

const persistDemo = () => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, branch: demo.branch, branchData: demo.branchData })
    )
  } catch {
    // 存储配额不足时只影响下次恢复
  }
}

const clone = (value: Record<string, string>) => ({ ...value })

/** 一个工作区：内置演示仓库或用户打开的本地目录，各自有独立的文件树与基线 */
export type WorkspaceEntry = {
  id: string
  name: string
  source: WorkspaceSource
  root: string
  branch: string
  branches: string[]
  files: Record<string, string>
  base: Record<string, string>
  handle?: FileSystemDirectoryHandle
  /** 本地目录文件过多被截断 */
  truncated: boolean
}

type WorkspaceStore = {
  ready: boolean
  loading: boolean
  error: string | null
  /** 全部工作区；第一个固定是演示仓库 */
  entries: WorkspaceEntry[]
  activeId: string | null
  /** 活动工作区的镜像字段：面板与工具直接读这些，避免到处按 id 查表 */
  source: WorkspaceSource
  name: string
  root: string
  branch: string
  branches: string[]
  files: Record<string, string>
  base: Record<string, string>
  handle?: FileSystemDirectoryHandle
  truncated: boolean
}

const demoBranchData = (branch = demo.branch) => demo.branchData[branch]

const demoEntry = (): WorkspaceEntry => {
  const data = demoBranchData()
  return {
    id: DEMO_ID,
    name: 'deepseek-agent',
    source: 'demo',
    root: 'demo/deepseek-agent',
    branch: demo.branch,
    branches: Object.keys(demo.branchData),
    files: clone(data.worktree),
    base: clone(data.head),
    truncated: false,
  }
}

const mirror = (entry: WorkspaceEntry) => ({
  source: entry.source,
  name: entry.name,
  root: entry.root,
  branch: entry.branch,
  branches: entry.branches,
  files: entry.files,
  base: entry.base,
  handle: entry.handle,
  truncated: entry.truncated,
})

const initialEntry = demoEntry()

export const useWorkspace = create<WorkspaceStore>(() => ({
  ready: false,
  loading: false,
  error: null,
  entries: [initialEntry],
  activeId: DEMO_ID,
  ...mirror(initialEntry),
}))

/** 多工作区列表（输入框选择器读它） */
export const useWorkspaceList = () => useWorkspace((state) => state.entries)

type SavedList = { version: number; activeId: string | null; local: { id: string; name: string }[] }

const readSavedList = (): SavedList => {
  try {
    const raw = localStorage.getItem(LIST_KEY)
    if (!raw) {
      return { version: STORAGE_VERSION, activeId: DEMO_ID, local: [] }
    }
    const saved = JSON.parse(raw) as Partial<SavedList>
    return {
      version: STORAGE_VERSION,
      activeId: typeof saved.activeId === 'string' ? saved.activeId : DEMO_ID,
      local: Array.isArray(saved.local)
        ? saved.local.filter(
            (item): item is { id: string; name: string } =>
              typeof item?.id === 'string' && typeof item?.name === 'string'
          )
        : [],
    }
  } catch {
    return { version: STORAGE_VERSION, activeId: DEMO_ID, local: [] }
  }
}

/**
 * 壳工作区的文件快照缓存。
 *
 * 浏览器分支靠 IndexedDB 里的目录句柄恢复，壳分支没有句柄可用，
 * 只能把上次读到的文件内容原样存下来——刷新后先拿它把面板填上，
 * 用户点刷新再走 refreshWorkspace 重新读磁盘。
 */
const SNAPSHOT_KEY = 'deepseek-agent:workspace-snapshots'

type ShellSnapshot = { name: string; files: Record<string, string> }

const readShellSnapshots = (): Record<string, ShellSnapshot> => {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as Record<string, ShellSnapshot>
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }
    const result: Record<string, ShellSnapshot> = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (value && typeof value.name === 'string' && value.files && typeof value.files === 'object') {
        result[id] = { name: value.name, files: value.files }
      }
    }
    return result
  } catch {
    return {}
  }
}

const persistShellSnapshot = (id: string, name: string, files: Record<string, string>) => {
  try {
    const all = readShellSnapshots()
    all[id] = { name, files }
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(all))
  } catch {
    // 文件多时可能超配额，忽略即可——刷新后重选一次就能回来
  }
}

const dropShellSnapshot = (id: string) => {
  try {
    const all = readShellSnapshots()
    delete all[id]
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(all))
  } catch {
    // 忽略
  }
}

const persistList = () => {
  const state = useWorkspace.getState()
  try {
    localStorage.setItem(
      LIST_KEY,
      JSON.stringify({
        version: STORAGE_VERSION,
        activeId: state.activeId,
        local: state.entries
          .filter((entry) => entry.source === 'local')
          .map((entry) => ({ id: entry.id, name: entry.name })),
      })
    )
  } catch {
    // 忽略存储失败
  }
}

const updateEntry = (id: string, update: (entry: WorkspaceEntry) => WorkspaceEntry) => {
  useWorkspace.setState((state) => {
    const entries = state.entries.map((entry) => (entry.id === id ? update(entry) : entry))
    const active = entries.find((entry) => entry.id === state.activeId)
    return { entries, ...(active ? mirror(active) : {}) }
  })
}

/** 切换活动工作区：镜像字段跟着换，面板与工具读到的是同一个快照 */
export const setActiveWorkspace = (id: string) => {
  const state = useWorkspace.getState()
  const entry = state.entries.find((item) => item.id === id)
  if (!entry || state.activeId === id) {
    return false
  }
  useWorkspace.setState({ activeId: id, ...mirror(entry), error: null })
  persistList()
  return true
}

/** 首次挂载时载入演示仓库，并尝试恢复上次打开的本地目录 */
export const initWorkspace = () => {
  if (useWorkspace.getState().ready) {
    return
  }
  const fresh = demoEntry()
  useWorkspace.setState({
    ready: true,
    entries: [fresh],
    activeId: DEMO_ID,
    ...mirror(fresh),
    error: null,
  })
  // 本地目录模式已下线：HarmonyOS 的目录授权是临时的，重开后必然失效，
  // 强行恢复只会让面板停在一个用不了的目录上。现在只保留应用内工作区，
  // 用户要带数据进来就走进口（zip 导入）。
  void restoreLocalWorkspaces
}

/** 从 IndexedDB 取回句柄；没有读写权限时保留占位，点开时再申请 */
const restoreLocalWorkspaces = async () => {
  const saved = readSavedList()
  const snapshots = readShellSnapshots()
  for (const item of saved.local) {
    const handle = await loadHandle(item.id)
    if (!handle) {
      // 壳工作区没有目录句柄，只剩上次存的快照——先把它填回去，
      // 用户点刷新时 refreshLocalWorkspace 会走 refreshWorkspace 重读磁盘。
      const snapshot = snapshots[item.id]
      if (!snapshot) {
        continue
      }
      const restored: WorkspaceEntry = {
        id: item.id,
        name: item.name,
        source: 'local',
        root: 'local',
        branch: '工作区',
        branches: [],
        files: clone(snapshot.files),
        base: clone(snapshot.files),
        truncated: false,
      }
      useWorkspace.setState((state) => ({
        entries: [...state.entries.filter((row) => row.id !== item.id), restored],
      }))
      if (saved.activeId === item.id) {
        setActiveWorkspace(item.id)
      }
      continue
    }
    try {
      const local = await readLocalWorkspace(handle)
      const entry: WorkspaceEntry = {
        id: item.id,
        name: item.name,
        source: 'local',
        root: local.git ? `local/${local.git.branch}` : 'local',
        branch: local.git?.branch ?? '工作区',
        branches: local.git?.branches ?? [],
        files: clone(local.files),
        base: clone(local.files),
        handle,
        truncated: local.truncated,
      }
      useWorkspace.setState((state) => ({
        entries: [...state.entries.filter((row) => row.id !== item.id), entry],
      }))
      if (saved.activeId === item.id) {
        setActiveWorkspace(item.id)
      }
    } catch {
      // 读不到目录时跳过，用户可以在选择器里移除
    }
  }
}

/** 切换分支（仅演示仓库）：换成该分支的基线与工作树 */
export const setBranch = (name: string) => {
  const state = useWorkspace.getState()
  const entry = state.entries.find((item) => item.id === state.activeId)
  if (!entry || entry.source !== 'demo' || !demo.branchData[name] || name === entry.branch) {
    return false
  }
  demo = { ...demo, branch: name }
  persistDemo()
  const data = demo.branchData[name]
  updateEntry(entry.id, (item) => ({
    ...item,
    branch: name,
    branches: Object.keys(demo.branchData),
    files: clone(data.worktree),
    base: clone(data.head),
  }))
  useWorkspace.setState({ error: null })
  return true
}

const VALID_BRANCH = /^[a-zA-Z0-9._/-]+$/

/** 新建分支：以当前工作树为基线，工作树保持不变，因此新分支 diff 为空 */
export const createBranch = (name: string): { ok: boolean; error?: string } => {
  const state = useWorkspace.getState()
  const entry = state.entries.find((item) => item.id === state.activeId)
  if (!entry || entry.source !== 'demo') {
    return { ok: false, error: 'local' }
  }
  const branch = name.trim()
  if (!branch || !VALID_BRANCH.test(branch) || branch.startsWith('-')) {
    return { ok: false, error: 'invalid' }
  }
  if (demo.branchData[branch]) {
    return { ok: false, error: 'exists' }
  }
  demo.branchData[branch] = {
    head: clone(entry.files),
    worktree: clone(entry.files),
  }
  demo = { ...demo, branch }
  persistDemo()
  updateEntry(entry.id, (item) => ({
    ...item,
    branch,
    branches: Object.keys(demo.branchData),
    base: clone(entry.files),
    files: clone(entry.files),
  }))
  useWorkspace.setState({ error: null })
  return { ok: true }
}

/** 写入文件：演示仓库写内存并持久化，本地目录写回磁盘 */
export const writeWorkspaceFile = async (path: string, content: string) => {
  if (!useWorkspace.getState().ready) {
    initWorkspace()
  }
  const state = useWorkspace.getState()
  const entry = state.entries.find((item) => item.id === state.activeId)
  if (!entry) {
    throw new Error('workspace not ready')
  }
  if (entry.source === 'demo') {
    const data = demoBranchData(entry.branch)
    data.worktree[path] = content
    persistDemo()
    updateEntry(entry.id, (item) => ({ ...item, files: clone(data.worktree) }))
    return
  }
  if (!entry.handle) {
    // 壳工作区：没有句柄，交给壳按相对路径落盘
    if (!canWriteViaShell()) {
      throw new Error('workspace not writable')
    }
    await writeFileViaShell(path, content)
    updateEntry(entry.id, (item) => {
      const files = { ...item.files, [path]: content }
      persistShellSnapshot(item.id, item.name, files)
      return { ...item, files }
    })
    return
  }
  const { writeLocalFile } = await import('./local.js')
  await writeLocalFile(entry.handle, path, content)
  updateEntry(entry.id, (item) => ({ ...item, files: { ...item.files, [path]: content } }))
}

/** 丢弃单个文件的改动：恢复基线内容 */
export const discardFile = async (path: string) => {
  const state = useWorkspace.getState()
  const entry = state.entries.find((item) => item.id === state.activeId)
  if (!entry) {
    return
  }
  if (entry.source === 'demo') {
    const data = demoBranchData(entry.branch)
    if (path in data.head) {
      data.worktree[path] = data.head[path]
    } else {
      Reflect.deleteProperty(data.worktree, path)
    }
    persistDemo()
    updateEntry(entry.id, (item) => ({ ...item, files: clone(data.worktree) }))
    return
  }
  if (path in entry.base) {
    await writeWorkspaceFile(path, entry.base[path])
  }
}

/** 丢弃全部改动 */
export const discardAll = async () => {
  const state = useWorkspace.getState()
  for (const item of diffWorkspace(state.base, state.files)) {
    await discardFile(item.path)
  }
}

/** 打开新文件夹并作为独立工作区加入列表 */
export const openLocalWorkspace = async () => {
  const state = useWorkspace.getState()
  if (state.loading) {
    return
  }
  useWorkspace.setState({ loading: true, error: null })
  try {
    // 鸿蒙壳：选目录、遍历、读文件都在原生侧做完，这里拿到的是文件快照
    if (canPickDirectoryViaShell()) {
      const folder = await pickFolderViaShell()
      if (!folder) {
        useWorkspace.setState({ loading: false })
        return
      }
      const sameShell = state.entries.find(
        (entry) => entry.source === 'local' && entry.name === folder.name
      )
      const shellEntry: WorkspaceEntry = {
        id: sameShell?.id ?? `local-${Date.now().toString(36)}`,
        name: folder.name,
        source: 'local',
        root: 'local',
        branch: '工作区',
        branches: [],
        files: clone(folder.files),
        base: clone(folder.files),
        truncated: folder.truncated,
      }
      useWorkspace.setState((current) => ({
        loading: false,
        entries: [...current.entries.filter((item) => item.id !== shellEntry.id), shellEntry],
        activeId: shellEntry.id,
        ...mirror(shellEntry),
        error: Object.keys(folder.files).length === 0 ? 'empty' : null,
      }))
      // 壳分支拿不到目录句柄，句柄那条恢复路走不通；列表本身必须存下来，
      // 否则刷新后这一项直接从面板里消失（之前就是这样丢的）。
      persistList()
      persistShellSnapshot(shellEntry.id, shellEntry.name, shellEntry.files)
      return
    }
    const handle = await pickDirectory()
    // 同一个目录重复打开时复用已有工作区，避免列表里堆同名项
    const same = state.entries.find(
      (entry) => entry.source === 'local' && entry.name === handle.name
    )
    const local = await readLocalWorkspace(handle)
    const id = same?.id ?? `local-${Date.now().toString(36)}`
    const entry: WorkspaceEntry = {
      id,
      name: handle.name,
      source: 'local',
      root: local.git ? `local/${local.git.branch}` : 'local',
      branch: local.git?.branch ?? '工作区',
      branches: local.git?.branches ?? [],
      files: clone(local.files),
      base: clone(local.files),
      handle,
      truncated: local.truncated,
    }
    await saveHandle(id, handle)
    useWorkspace.setState((current) => ({
      entries: [...current.entries.filter((row) => row.id !== id), entry],
      activeId: id,
      ...mirror(entry),
      loading: false,
      error: Object.keys(local.files).length === 0 ? 'empty' : null,
    }))
    persistList()
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError'
    useWorkspace.setState({ loading: false, error: aborted ? null : 'open' })
  }
}

/** 重新扫描本地目录：基线保持打开时的快照，便于看出磁盘上的新改动 */
export const refreshLocalWorkspace = async () => {
  const state = useWorkspace.getState()
  const entry = state.entries.find((item) => item.id === state.activeId)
  if (!entry || entry.source !== 'local') {
    return
  }
  if (!entry.handle) {
    // 壳工作区：让壳用记住的目录 URI 重扫，不用再弹选择器
    useWorkspace.setState({ loading: true })
    try {
      let folder = await refreshFolderViaShell()
      if (!folder) {
        // 壳丢了目录 URI（应用重开后必然发生，HarmonyOS 的目录授权是临时的），
        // 直接让用户重选一次，比报错后让他自己找按钮省事。
        folder = await pickFolderViaShell()
        if (!folder) {
          useWorkspace.setState({ loading: false, error: 'reselect' })
          return
        }
      }
      updateEntry(entry.id, (item) => {
        const files = clone(folder.files)
        persistShellSnapshot(item.id, folder.name, files)
        return { ...item, name: folder.name, files, truncated: folder.truncated }
      })
      useWorkspace.setState({ loading: false, error: null })
    } catch {
      useWorkspace.setState({ loading: false, error: 'open' })
    }
    return
  }
  useWorkspace.setState({ loading: true })
  try {
    const ok = await ensurePermission(entry.handle)
    if (!ok) {
      useWorkspace.setState({ loading: false, error: 'denied' })
      return
    }
    const local = await readLocalWorkspace(entry.handle)
    updateEntry(entry.id, (item) => ({
      ...item,
      files: clone(local.files),
      branches: local.git?.branches ?? [],
      branch: local.git?.branch ?? item.branch,
      root: local.git ? `local/${local.git.branch}` : 'local',
      truncated: local.truncated,
    }))
    useWorkspace.setState({ loading: false, error: null })
  } catch {
    useWorkspace.setState({ loading: false, error: 'open' })
  }
}

/** 移除工作区：本地目录同时清掉句柄，演示仓库只重置文件 */
export const removeWorkspace = async (id: string) => {
  const state = useWorkspace.getState()
  const entry = state.entries.find((item) => item.id === id)
  if (!entry || entry.id === DEMO_ID) {
    return false
  }
  await deleteHandle(id)
  dropShellSnapshot(id)
  const entries = state.entries.filter((item) => item.id !== id)
  // 删掉的是当前工作区时，回落到演示仓库（它永远在列表里）
  const fallback = state.activeId === id ? entries[0] : undefined
  useWorkspace.setState({
    entries,
    ...(fallback ? { activeId: fallback.id, ...mirror(fallback) } : {}),
  })
  persistList()
  return true
}

/** 把当前工作区的全部文件打包成 zip，交给用户保存到手机里 */
export const exportWorkspace = async (): Promise<{ ok: boolean; error?: string }> => {
  const state = useWorkspace.getState()
  const entry = state.entries.find((item) => item.id === state.activeId)
  if (!entry) {
    return { ok: false, error: 'no-workspace' }
  }
  if (!canTransferViaShell()) {
    return { ok: false, error: 'unsupported' }
  }
  try {
    const result = await exportViaShell(entry.files)
    return { ok: result.ok, error: result.error }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'export failed' }
  }
}

/** 从用户选的 zip 导入文件，全部写进当前工作区（同路径覆盖，其余保留） */
export const importWorkspace = async (): Promise<{ ok: boolean; error?: string; count?: number }> => {
  const state = useWorkspace.getState()
  const entry = state.entries.find((item) => item.id === state.activeId)
  if (!entry) {
    return { ok: false, error: 'no-workspace' }
  }
  if (!canTransferViaShell()) {
    return { ok: false, error: 'unsupported' }
  }
  try {
    const result = await importViaShell()
    if (!result.ok || !result.files) {
      return { ok: false, error: result.error ?? 'import failed' }
    }
    const incoming = result.files
    const count = Object.keys(incoming).length
    if (count === 0) {
      return { ok: false, error: 'empty' }
    }
    updateEntry(entry.id, (item) => ({ ...item, files: { ...item.files, ...incoming } }))
    // 演示仓库要落盘，本地目录靠下次刷新同步
    if (entry.source === 'demo') {
      const data = demoBranchData(entry.branch)
      for (const [path, content] of Object.entries(incoming)) {
        data.worktree[path] = String(content)
      }
      persistDemo()
    } else {
      persistShellSnapshot(entry.id, entry.name, { ...entry.files, ...incoming })
    }
    return { ok: true, count }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'import failed' }
  }
}

/** 回到演示仓库，并把它的文件树同步成内存里的最新状态 */
export const backToDemo = () => {
  updateEntry(DEMO_ID, () => demoEntry())
  setActiveWorkspace(DEMO_ID)
}

/** 供工具与界面读取的一致快照 */
export const workspaceSnapshot = (): WorkspaceSnapshot | null => {
  if (!useWorkspace.getState().ready) {
    initWorkspace()
  }
  const state = useWorkspace.getState()
  const entry = state.entries.find((item) => item.id === state.activeId)
  if (!entry) {
    return null
  }
  // 壳工作区没有目录句柄，但只要能通过壳写盘就是可用的工作区。
  // 之前这里只认 handle，导致手机上的本地目录在工具侧永远返回 null。
  if (entry.source === 'local' && !entry.handle && !canWriteViaShell()) {
    return null
  }
  return {
    source: entry.source,
    name: entry.name,
    root: entry.root,
    branch: entry.branch,
    branches: entry.branches,
    files: entry.files,
    base: entry.base,
    writable: entry.source === 'demo' || Boolean(entry.handle) || canWriteViaShell(),
    handle: entry.handle,
  }
}

/** 测试与演示用：清除保存的演示改动 */
export const resetWorkspace = () => {
  demo = seed()
  persistDemo()
  useWorkspace.setState({
    ready: false,
    activeId: DEMO_ID,
    handle: undefined,
    error: null,
    truncated: false,
  })
  initWorkspace()
}

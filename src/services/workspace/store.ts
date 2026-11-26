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
  canUseSandboxWorkspace,
  setActiveSandboxWorkspace,
  deleteSandboxFile,
  readSandboxState,
  readSandboxTree,
  replaceSandboxTree,
  writeSandboxFile,
  writeSandboxState,
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
  /** 归档：仍保留，但不占侧栏位置，从「归档管理」里恢复 */
  archived?: boolean
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

type SavedWorkspace = { id: string; name: string; root?: string; archived?: boolean }
type SavedList = {
  version: number
  activeId: string | null
  local: SavedWorkspace[]
  /** 用户自建的工作区；演示仓库不进来，它永远存在 */
  custom: SavedWorkspace[]
}

const readSavedList = (): SavedList => {
  try {
    const raw = localStorage.getItem(LIST_KEY)
    if (!raw) {
      return { version: STORAGE_VERSION, activeId: DEMO_ID, local: [], custom: [] }
    }
    const saved = JSON.parse(raw) as Partial<SavedList>
    return {
      version: STORAGE_VERSION,
      activeId: typeof saved.activeId === 'string' ? saved.activeId : DEMO_ID,
      local: Array.isArray(saved.local)
        ? saved.local.filter(
            (item): item is SavedWorkspace =>
              typeof item?.id === 'string' && typeof item?.name === 'string'
          )
        : [],
      custom: Array.isArray((saved as Partial<SavedList>).custom)
        ? (saved as SavedList).custom.filter(
            (item): item is SavedWorkspace =>
              typeof item?.id === 'string' && typeof item?.name === 'string'
          )
        : [],
    }
  } catch {
    return { version: STORAGE_VERSION, activeId: DEMO_ID, local: [], custom: [] }
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

/**
 * 把「当前分支 + 各分支基线」写进沙箱 state.json。
 *
 * 工作树本身是 files/ 里的真文件，这里只存基线和分支信息——
 * 两者凑起来才能算 diff，也才能切分支。
 */
const syncSandboxState = async () => {
  if (!canUseSandboxWorkspace()) {
    return
  }
  try {
    const data: Record<string, { head: Record<string, string>; worktree: Record<string, string> }> = {}
    for (const [name, branch] of Object.entries(demo.branchData)) {
      data[name] = { head: branch.head, worktree: branch.worktree }
    }
    await writeSandboxState(JSON.stringify({ branch: demo.branch, branchData: data }))
  } catch {
    // 沙箱写失败不影响内存态
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
        custom: state.entries
          .filter((entry) => entry.source === 'demo' && entry.id !== DEMO_ID)
          .map((entry) => ({ id: entry.id, name: entry.name, root: entry.root, archived: entry.archived })),
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
/**
 * 挑一个默认工作区。
 *
 * 优先用传入的 id（上次选的那个），不可用就退回「最新的未归档工作区」，
 * 也就是列表里最后新建的一个——新建即最新，符合直觉。
 */
const pickDefaultWorkspace = (entries: WorkspaceEntry[], preferred?: string | null): WorkspaceEntry | null => {
  const usable = entries.filter((item) => !item.archived)
  if (usable.length === 0) {
    return null
  }
  const preferredEntry = preferred ? usable.find((item) => item.id === preferred) : undefined
  return preferredEntry ?? usable[usable.length - 1]
}

/**
 * 让当前工作区保持可用：指向的那个归档/删掉了就自动切到最新的。
 *
 * 归档管理里恢复/归档之后调一次，避免 activeId 悬空。
 */
export const ensureActiveWorkspace = () => {
  // 先保证演示仓库没被归档，否则后面没落脚点
  const before = useWorkspace.getState()
  if (before.entries.some((item) => item.id === DEMO_ID && item.archived)) {
    useWorkspace.setState({
      entries: before.entries.map((item) =>
        item.id === DEMO_ID ? { ...item, archived: false } : item
      ),
    })
  }
  const state = useWorkspace.getState()
  const current = state.entries.find((item) => item.id === state.activeId)
  if (current && !current.archived) {
    return
  }
  const next = pickDefaultWorkspace(state.entries, null)
  if (!next) {
    return
  }
  useWorkspace.setState({ activeId: next.id, ...mirror(next), error: null })
  persistList()
  if (canUseSandboxWorkspace()) {
    void setActiveSandboxWorkspace(next.id)
  }
}

export const setActiveWorkspace = (id: string) => {
  const state = useWorkspace.getState()
  const entry = state.entries.find((item) => item.id === id)
  if (!entry || state.activeId === id) {
    return false
  }
  useWorkspace.setState({ activeId: id, ...mirror(entry), error: null })
  persistList()
  // 通知壳切到对应目录，多工作区各自独立
  if (canUseSandboxWorkspace()) {
    void setActiveSandboxWorkspace(id)
  }
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
  // 少了括号就只是取函数引用，根本不执行——自建工作区全靠它恢复
  void restoreLocalWorkspaces()
  void restoreSandboxWorkspace()
}

/** 从 IndexedDB 取回句柄；没有读写权限时保留占位，点开时再申请 */
/**
 * 启动时从沙箱恢复工作区。
 *
 * 沙箱里有两样东西：state.json（分支与基线）和 files/（真工作树）。
 * 两者都在就直接接管；都不在说明是首次启动，灌默认演示数据。
 */
const restoreSandboxWorkspace = async () => {
  // 桥接是 Web 组件创建时才注入的，启动那一刻 __DS_SHELL__ 往往还没挂上。
  // 直接判 canUseSandboxWorkspace() 会永远是 false，得轮询等它就绪。
  let ready = canUseSandboxWorkspace()
  for (let i = 0; i < 40 && !ready; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    ready = canUseSandboxWorkspace()
  }
  if (!ready) {
    return
  }
  try {
    const stateRaw = await readSandboxState()
    const tree = await readSandboxTree()
    if (!tree.ok || !tree.files) {
      return
    }
    const fileCount = Object.keys(tree.files).length
    const parsed = JSON.parse(stateRaw) as {
      branch?: string
      branchData?: Record<string, { head: Record<string, string>; worktree: Record<string, string> }>
    }
    if (fileCount === 0 || !parsed.branchData) {
      // 沙箱是空的：把默认演示仓库灌进去，之后一切以磁盘为准
      await seedSandbox()
      return
    }
    // 沙箱有货：用它覆盖内存里的演示数据
    demo = {
      branch: parsed.branch ?? demo.branch,
      branchData: parsed.branchData,
    }
    const fresh = demoEntry()
    useWorkspace.setState((current) => ({
      entries: [fresh, ...current.entries.filter((item) => item.id !== DEMO_ID)],
      activeId: DEMO_ID,
      ...mirror(fresh),
      error: fileCount === 0 ? 'empty' : null,
    }))
  } catch {
    // 沙箱异常就维持内存态
  }
}

/** 首次启动：把默认演示仓库写进沙箱 */
const seedSandbox = async () => {
  try {
    const fresh = demoEntry()
    await replaceSandboxTree(fresh.files)
    await syncSandboxState()
  } catch {
    // 写不进去就只跑内存态
  }
}

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

  // 用户自建的工作区：内容是空的或从沙箱读，重启后按 id 重建条目
  for (const item of saved.custom) {
    const restored: WorkspaceEntry = {
      id: item.id,
      name: item.name,
      source: 'demo',
      root: item.root ?? `workspaces/${item.id}`,
      branch: 'main',
      branches: ['main'],
      files: {},
      base: {},
      truncated: false,
      // 演示仓库是保底工作区，历史上被误归档过，恢复时强制清掉
      archived: item.id === DEMO_ID ? false : item.archived === true,
    }
    useWorkspace.setState((state) => ({
      entries: state.entries.some((e) => e.id === item.id)
        ? state.entries
        : [...state.entries, restored],
    }))
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
  // 切分支要换一整套工作树，沙箱里的 files/ 也得跟着换
  if (canUseSandboxWorkspace()) {
    void replaceSandboxTree(data.worktree).catch(() => {})
    void syncSandboxState()
  }
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
    // 同步到沙箱：真文件落盘，重启后从这里恢复，智能体也能直接按路径读
    if (canUseSandboxWorkspace()) {
      void writeSandboxFile(path, content).catch(() => {})
      void syncSandboxState()
    }
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
    // 沙箱里的对应文件也要删，否则磁盘上会留一个内存里不存在的文件
    if (canUseSandboxWorkspace()) {
      void deleteSandboxFile(path).catch(() => {})
    }
    }
    persistDemo()
    updateEntry(entry.id, (item) => ({ ...item, files: clone(data.worktree) }))
    return
  }
  if (path in entry.base) {
    await writeWorkspaceFile(path, entry.base[path])
  }
}

/**
 * 真正删掉一个文件：从工作树里移除，并同步删掉沙箱里的实体。
 *
 * 和 discardFile 的区别：discardFile 是「回到基线」，新文件会回到不存在，
 * 但基线里本来就有的文件只是恢复内容、不会消失。这里是直接抹掉路径。
 */
export const deleteWorkspaceFile = async (path: string): Promise<boolean> => {
  const state = useWorkspace.getState()
  const entry = state.entries.find((item) => item.id === state.activeId)
  if (!entry) {
    return false
  }
  if (entry.source === 'demo') {
    const data = demoBranchData(entry.branch)
    if (!(path in data.worktree)) {
      return false
    }
    Reflect.deleteProperty(data.worktree, path)
    persistDemo()
    updateEntry(entry.id, (item) => ({ ...item, files: clone(data.worktree) }))
    if (canUseSandboxWorkspace()) {
      await deleteSandboxFile(path).catch(() => {})
    }
    return true
  }
  if (!(path in entry.files)) {
    return false
  }
  const { [path]: _removed, ...rest } = entry.files
  updateEntry(entry.id, (item) => ({ ...item, files: rest }))
  if (canUseSandboxWorkspace()) {
    await deleteSandboxFile(path).catch(() => {})
  }
  return true
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

/** 新建一个空工作区：沙箱里对应一个独立目录，从空白开始 */
export const createWorkspace = (name: string): { ok: boolean; error?: string; id?: string } => {
  const trimmed = name.trim()
  if (!trimmed) {
    return { ok: false, error: 'empty' }
  }
  const state = useWorkspace.getState()
  if (state.entries.some((item) => item.name === trimmed)) {
    return { ok: false, error: 'exists' }
  }
  const id = `ws_${Date.now().toString(36)}`
  const entry: WorkspaceEntry = {
    id,
    name: trimmed,
    source: 'demo',
    branch: 'main',
    branches: ['main'],
    base: {},
    files: {},
    root: `workspaces/${id}`,
    truncated: false,
  }
  useWorkspace.setState({
    entries: [...state.entries, entry],
    activeId: id,
    branch: 'main',
    branches: ['main'],
    base: {},
    files: {},
    source: 'demo',
    name: trimmed,
    error: null,
  })
  persistList()
  // 切到新目录，并清空它（新建即空白）
  if (canUseSandboxWorkspace()) {
    void (async () => {
      await setActiveSandboxWorkspace(id)
      await replaceSandboxTree({})
      await writeSandboxState(JSON.stringify({ branch: 'main', branchData: { main: { head: {}, worktree: {} } } }))
    })()
  }
  return { ok: true, id }
}

/** 归档工作区：保留目录与会话，只是从侧栏收起来 */
export const archiveWorkspace = (id: string) => {
  const state = useWorkspace.getState()
  const target = state.entries.find((item) => item.id === id)
  if (!target) {
    return false
  }
  // 演示仓库是保底工作区，归档了选择器就空了，没有可回的落点
  if (id === DEMO_ID) {
    return false
  }
  const entries = state.entries.map((item) => (item.id === id ? { ...item, archived: true } : item))
  // 归档的是当前工作区，落到第一个未归档的
  const fallback = state.activeId === id ? entries.find((item) => !item.archived && item.id !== id) : undefined
  useWorkspace.setState({
    entries,
    ...(fallback ? { activeId: fallback.id, ...mirror(fallback) } : {}),
  })
  persistList()
  return true
}

/** 取消归档 */
export const unarchiveWorkspace = (id: string) => {
  const state = useWorkspace.getState()
  if (!state.entries.some((item) => item.id === id)) {
    return false
  }
  useWorkspace.setState({
    entries: state.entries.map((item) => (item.id === id ? { ...item, archived: false } : item)),
  })
  persistList()
  return true
}

/** 重命名工作区 */
export const renameWorkspace = (id: string, name: string) => {
  const trimmed = name.trim()
  if (!trimmed) {
    return false
  }
  const state = useWorkspace.getState()
  if (!state.entries.some((item) => item.id === id)) {
    return false
  }
  const entries = state.entries.map((item) => (item.id === id ? { ...item, name: trimmed } : item))
  const active = entries.find((item) => item.id === state.activeId)
  useWorkspace.setState({ entries, ...(active ? { name: active.name } : {}) })
  persistList()
  return true
}

/** 移除工作区：本地目录同时清掉句柄，演示仓库只重置文件 */
export const removeWorkspace = async (id: string): Promise<{ ok: boolean; reason?: 'not-found' | 'protected' }> => {
  const state = useWorkspace.getState()
  const entry = state.entries.find((item) => item.id === id)
  if (!entry) {
    return { ok: false, reason: 'not-found' }
  }
  // 演示仓库是保底工作区，删不得；但对用户来说「没反应」比报错更糟，得说清楚
  if (entry.id === DEMO_ID) {
    return { ok: false, reason: 'protected' }
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
  return { ok: true }
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
    // 导入的文件同样落到沙箱，保证磁盘和内存一致
    if (canUseSandboxWorkspace()) {
      void replaceSandboxTree({ ...entry.files, ...incoming }).catch(() => {})
    }
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

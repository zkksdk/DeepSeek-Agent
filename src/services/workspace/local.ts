import { readGitInfo, type GitInfo } from './git.js'
import { isTextPath, sortPaths } from './types.js'

/** 目录选择 API 只在 Chromium 系可用，按需判断 */
type DirectoryPicker = (options?: {
  mode?: 'read' | 'readwrite'
}) => Promise<FileSystemDirectoryHandle>

type ShellPicker = {
  pickFolder?: () => Promise<string>
  /** 往上次选中的目录写文件，返回 {"ok":true} 或 {"ok":false,"error":"..."} */
  writeWorkspaceFile?: (path: string, content: string) => Promise<string>
  /** 重扫上次选中的目录，返回和 pickFolder 一样的快照 */
  refreshWorkspace?: () => Promise<string>
  /** 把工作区打包成 zip 交给用户保存 */
  exportWorkspace?: (filesJson: string) => Promise<string>
  /** 选一个 zip 解压，返回其中的文本文件 */
  importWorkspace?: () => Promise<string>
  /** 读沙箱工作区状态（当前分支 + 各分支基线） */
  readWorkspaceState?: () => Promise<string>
  /** 写沙箱工作区状态 */
  writeWorkspaceState?: (json: string) => Promise<string>
  /** 读沙箱工作树，返回 { ok, files } */
  readWorkspaceTree?: () => Promise<string>
  /** 写沙箱工作树里的一个文件 */
  writeSandboxFile?: (path: string, content: string) => Promise<string>
  /** 删沙箱工作树里的一个文件 */
  deleteSandboxFile?: (path: string) => Promise<string>
  /** 用完整快照重建沙箱工作树 */
  replaceWorkspaceTree?: (filesJson: string) => Promise<string>
  /** 沙箱现状：路径、文件数、字节数 */
  sandboxInfo?: () => Promise<string>
  /** 清空沙箱工作树 */
  clearSandbox?: () => Promise<string>
  /** 列沙箱目录 */
  listSandboxDir?: (relPath: string) => Promise<string>
  /** 读沙箱文件内容 */
  readSandboxFile?: (relPath: string) => Promise<string>
}

const shellBridge = () => (window as unknown as { __DS_SHELL__?: ShellPicker }).__DS_SHELL__

/** 壳里有没有原生的文件夹选择（鸿蒙版走这条） */
export const canPickDirectoryViaShell = () => typeof shellBridge()?.pickFolder === 'function'

/** 壳能不能把改动写回磁盘；不能时工作区只能当只读预览 */
export const canWriteViaShell = () => typeof shellBridge()?.writeWorkspaceFile === 'function'

/** 壳能不能用已有目录 URI 重扫，不用再弹选择器 */
export const canRefreshViaShell = () => typeof shellBridge()?.refreshWorkspace === 'function'

/** 能选目录：壳优先，其次浏览器原生 */
export const canPickDirectory = () =>
  canPickDirectoryViaShell() ||
  typeof (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker ===
    'function'

export type ShellFolder = {
  files: Record<string, string>
  truncated: boolean
  name: string
}

/**
 * 让壳去选文件夹并读文件。
 *
 * ArkWeb 没有 showDirectoryPicker，所以选目录、遍历、读文本都在壳里做了，
 * 这里只拿到一份 { path: content } 快照。代价是拿不到目录句柄，无法持久化——
 * 重启后这一条要重选，但至少能用。
 */
export const pickFolderViaShell = async (): Promise<ShellFolder | null> => {
  const shell = (window as unknown as { __DS_SHELL__?: ShellPicker }).__DS_SHELL__
  if (!shell?.pickFolder) {
    return null
  }
  const raw = await shell.pickFolder()
  if (!raw) {
    return null
  }
  return JSON.parse(raw) as ShellFolder
}

/**
 * 把改动写回壳选中的那个目录。
 *
 * ArkWeb 没有 FileSystemDirectoryHandle，Web 端算不出绝对路径，
 * 只能把相对路径交给壳去拼。失败时抛出错误，由 store 层决定怎么提示。
 */
export const writeFileViaShell = async (path: string, content: string) => {
  const shell = shellBridge()
  if (!shell?.writeWorkspaceFile) {
    throw new Error('shell write unsupported')
  }
  const raw = await shell.writeWorkspaceFile(path, content)
  if (!raw) {
    throw new Error('shell write failed')
  }
  const result = JSON.parse(raw) as { ok?: boolean; error?: string }
  if (!result.ok) {
    throw new Error(result.error ?? 'shell write failed')
  }
}

/** 壳能不能把改动写回磁盘；不能时工作区只能当只读预览 */
export const refreshFolderViaShell = async (): Promise<ShellFolder | null> => {
  const shell = shellBridge()
  if (!shell?.refreshWorkspace) {
    return null
  }
  const raw = await shell.refreshWorkspace()
  if (!raw) {
    return null
  }
  return JSON.parse(raw) as ShellFolder
}

export type ShellTransferResult = {
  ok: boolean
  error?: string
  files?: Record<string, string>
}

/** 壳里能不能导出/导入 */
export const canTransferViaShell = () =>
  typeof shellBridge()?.exportWorkspace === 'function' && typeof shellBridge()?.importWorkspace === 'function'

/** 把工作区打包交给用户保存 */
export const exportViaShell = async (files: Record<string, string>): Promise<ShellTransferResult> => {
  const shell = shellBridge()
  if (!shell?.exportWorkspace) {
    throw new Error('shell export unsupported')
  }
  const raw = await shell.exportWorkspace(JSON.stringify(files))
  if (!raw) {
    throw new Error('shell export failed')
  }
  return JSON.parse(raw) as ShellTransferResult
}

/** 让用户选一个 zip 导入 */
export const importViaShell = async (): Promise<ShellTransferResult> => {
  const shell = shellBridge()
  if (!shell?.importWorkspace) {
    throw new Error('shell import unsupported')
  }
  const raw = await shell.importWorkspace()
  if (!raw) {
    throw new Error('shell import failed')
  }
  return JSON.parse(raw) as ShellTransferResult
}

/** 沙箱工作区是不是可用（鸿蒙壳独有） */
export const canUseSandboxWorkspace = () =>
  typeof shellBridge()?.readWorkspaceTree === 'function' &&
  typeof shellBridge()?.writeSandboxFile === 'function'

export type SandboxTree = { ok: boolean; files?: Record<string, string>; error?: string }

/** 读沙箱工作树 */
export const readSandboxTree = async (): Promise<SandboxTree> => {
  const shell = shellBridge()
  if (!shell?.readWorkspaceTree) throw new Error('sandbox unsupported')
  const raw = await shell.readWorkspaceTree()
  if (!raw) throw new Error('sandbox read failed')
  return JSON.parse(raw) as SandboxTree
}

/** 写沙箱里的一个文件 */
export const writeSandboxFile = async (path: string, content: string) => {
  const shell = shellBridge()
  if (!shell?.writeSandboxFile) throw new Error('sandbox unsupported')
  const raw = await shell.writeSandboxFile(path, content)
  const result = JSON.parse(raw ?? '{}') as { ok?: boolean; error?: string }
  if (!result.ok) throw new Error(result.error ?? 'sandbox write failed')
}

/** 删沙箱里的一个文件 */
export const deleteSandboxFile = async (path: string) => {
  const shell = shellBridge()
  if (!shell?.deleteSandboxFile) return
  await shell.deleteSandboxFile(path)
}

/** 用完整快照重建沙箱工作树 */
export const replaceSandboxTree = async (files: Record<string, string>): Promise<number> => {
  const shell = shellBridge()
  if (!shell?.replaceWorkspaceTree) throw new Error('sandbox unsupported')
  const raw = await shell.replaceWorkspaceTree(JSON.stringify(files))
  const result = JSON.parse(raw ?? '{}') as { ok?: boolean; count?: number; error?: string }
  if (!result.ok) throw new Error(result.error ?? 'sandbox replace failed')
  return result.count ?? 0
}

/** 读/写沙箱工作区状态 */
export type SandboxInfo = { ok: boolean; path?: string; count?: number; bytes?: number; error?: string }

/** 读沙箱现状 */
export type SandboxEntry = { name: string; dir: boolean; size: number; mtime: number }
export type SandboxListing = { ok: boolean; path?: string; items?: SandboxEntry[]; error?: string }

/** 列沙箱某个目录 */
export const listSandboxDir = async (relPath: string): Promise<SandboxListing> => {
  const shell = shellBridge()
  if (!shell?.listSandboxDir) return { ok: false, error: 'unsupported' }
  try {
    return JSON.parse((await shell.listSandboxDir(relPath)) ?? '{}') as SandboxListing
  } catch {
    return { ok: false, error: 'parse' }
  }
}

/** 读沙箱文件内容 */
export const readSandboxFile = async (relPath: string) => {
  const shell = shellBridge()
  if (!shell?.readSandboxFile) return { ok: false as const, error: 'unsupported' as string }
  try {
    const parsed = JSON.parse((await shell.readSandboxFile(relPath)) ?? '{}') as {
      ok?: boolean
      content?: string
      size?: number
      error?: string
    }
    if (!parsed.ok) return { ok: false as const, error: parsed.error ?? 'failed' }
    return { ok: true as const, content: parsed.content ?? '', size: parsed.size ?? 0 }
  } catch {
    return { ok: false as const, error: 'parse' }
  }
}

export const getSandboxInfo = async (): Promise<SandboxInfo> => {
  const shell = shellBridge()
  if (!shell?.sandboxInfo) return { ok: false, error: 'unsupported' }
  try {
    return JSON.parse((await shell.sandboxInfo()) ?? '{}') as SandboxInfo
  } catch {
    return { ok: false, error: 'parse' }
  }
}

/** 清空沙箱 */
export const clearSandboxTree = async (): Promise<boolean> => {
  const shell = shellBridge()
  if (!shell?.clearSandbox) return false
  try {
    const raw = await shell.clearSandbox()
    return Boolean((JSON.parse(raw ?? '{}') as { ok?: boolean }).ok)
  } catch {
    return false
  }
}

export const readSandboxState = async (): Promise<string> => {
  const shell = shellBridge()
  if (!shell?.readWorkspaceState) return '{}'
  return (await shell.readWorkspaceState()) || '{}'
}

export const writeSandboxState = async (json: string) => {
  const shell = shellBridge()
  if (!shell?.writeWorkspaceState) return
  await shell.writeWorkspaceState(json)
}

export const pickDirectory = async (): Promise<FileSystemDirectoryHandle> => {
  const picker = (window as Window & { showDirectoryPicker?: DirectoryPicker })
    .showDirectoryPicker
  if (!picker) {
    throw new Error('unsupported')
  }
  return picker({ mode: 'readwrite' })
}

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.cache',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  'vendor',
  'coverage',
  '.idea',
  '.vscode',
])

const MAX_FILES = 400
const MAX_DEPTH = 8
const MAX_BYTES = 160 * 1024

export type LocalWorkspace = {
  files: Record<string, string>
  git: GitInfo | null
  truncated: boolean
}

const readDir = async (
  dir: FileSystemDirectoryHandle,
  prefix: string,
  files: Record<string, string>,
  depth: number,
  state: { truncated: boolean }
): Promise<void> => {
  if (depth > MAX_DEPTH || state.truncated) {
    return
  }
  const entries: [string, FileSystemFileHandle | FileSystemDirectoryHandle][] = []
  try {
    for await (const entry of dir.entries()) {
      entries.push(entry)
    }
  } catch {
    return
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]))

  for (const [name, handle] of entries) {
    if (Object.keys(files).length >= MAX_FILES) {
      state.truncated = true
      return
    }
    const path = prefix ? prefix + '/' + name : name
    if (handle.kind === 'directory') {
      if (!SKIP_DIRS.has(name) && !name.startsWith('.')) {
        await readDir(handle, path, files, depth + 1, state)
      }
      continue
    }
    if (!isTextPath(path)) {
      continue
    }
    try {
      const file = await handle.getFile()
      if (file.size > MAX_BYTES) {
        continue
      }
      files[path] = await file.text()
    } catch {
      // 单个文件读失败不影响整体
    }
  }
}

/** 读取本地文件夹文本快照，并尝试解析 .git */
export const readLocalWorkspace = async (
  handle: FileSystemDirectoryHandle
): Promise<LocalWorkspace> => {
  const files: Record<string, string> = {}
  const state = { truncated: false }
  await readDir(handle, '', files, 0, state)
  const sorted: Record<string, string> = {}
  for (const path of sortPaths(Object.keys(files))) {
    sorted[path] = files[path]
  }
  const git = await readGitInfo(handle)
  return { files: sorted, git, truncated: state.truncated }
}

/** 写入本地文件，必要时创建中间目录 */
export const writeLocalFile = async (
  root: FileSystemDirectoryHandle,
  path: string,
  content: string
) => {
  const parts = path.split('/').filter(Boolean)
  const name = parts.pop()
  if (!name) {
    throw new Error('invalid path')
  }
  let dir = root
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true })
  }
  const file = await dir.getFileHandle(name, { create: true })
  const writable = await file.createWritable()
  try {
    await writable.write(content)
  } finally {
    await writable.close()
  }
}

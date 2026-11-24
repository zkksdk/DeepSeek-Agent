import { readGitInfo, type GitInfo } from './git.js'
import { isTextPath, sortPaths } from './types.js'

/** 目录选择 API 只在 Chromium 系可用，按需判断 */
type DirectoryPicker = (options?: {
  mode?: 'read' | 'readwrite'
}) => Promise<FileSystemDirectoryHandle>

type ShellPicker = { pickFolder?: () => Promise<string> }

/** 壳里有没有原生的文件夹选择（鸿蒙版走这条） */
export const canPickDirectoryViaShell = () =>
  typeof (window as unknown as { __DS_SHELL__?: ShellPicker }).__DS_SHELL__?.pickFolder ===
  'function'

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

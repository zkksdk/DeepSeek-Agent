/** 工作区来源：内置演示仓库，或用户本地文件夹 */
export type WorkspaceSource = 'demo' | 'local'

export type FileStatus = 'added' | 'modified' | 'deleted' | 'unchanged'

/** 单个文件的差异统计 */
export type FileDiffStat = {
  path: string
  status: FileStatus
  additions: number
  deletions: number
}

/** 展示给界面的工作区快照 */
export type WorkspaceSnapshot = {
  source: WorkspaceSource
  /** 仓库名 */
  name: string
  /** 顶部展示的路径，如 demo/deepseek-agent */
  root: string
  branch: string
  branches: string[]
  /** 工作树：路径 → 文本内容 */
  files: Record<string, string>
  /** 基线（HEAD）：路径 → 文本内容，用于算 diff */
  base: Record<string, string>
  /** 是否可写（演示仓库与已授权的本地目录） */
  writable: boolean
  /** 本地模式下的目录句柄 */
  handle?: FileSystemDirectoryHandle
}

export type WorkspaceBranch = { name: string; files: Record<string, string> }

/** 判断文本文件是否值得纳入工作区 */
export const TEXT_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'md',
  'mdx',
  'css',
  'scss',
  'less',
  'html',
  'htm',
  'py',
  'go',
  'rs',
  'java',
  'kt',
  'rb',
  'php',
  'c',
  'h',
  'cc',
  'cpp',
  'hpp',
  'cs',
  'swift',
  'sh',
  'bash',
  'zsh',
  'yml',
  'yaml',
  'toml',
  'ini',
  'xml',
  'svg',
  'sql',
  'txt',
  'env',
  'gitignore',
  'lock',
])

export const isTextPath = (path: string) => {
  const name = path.split('/').pop() ?? ''
  if (!name.includes('.')) {
    return TEXT_EXTENSIONS.has(name.toLowerCase())
  }
  const extension = name.split('.').pop()
  return extension ? TEXT_EXTENSIONS.has(extension.toLowerCase()) : false
}

/** 按目录层级的自然顺序排列文件 */
export const sortPaths = (paths: string[]) =>
  [...paths].sort((a, b) => {
    const left = a.split('/')
    const right = b.split('/')
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      if (left[index] !== right[index]) {
        // 同层目录排在文件前面
        const dirA = index < left.length - 1
        const dirB = index < right.length - 1
        if (dirA !== dirB) {
          return dirA ? -1 : 1
        }
        return left[index].localeCompare(right[index])
      }
    }
    return left.length - right.length
  })

/** 文件名，用于树节点 */
export const baseName = (path: string) => path.split('/').pop() ?? path

/** 所在目录 */
export const dirName = (path: string) => path.split('/').slice(0, -1).join('/')

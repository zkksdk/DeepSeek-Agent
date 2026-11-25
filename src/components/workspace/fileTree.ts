import type { FileDiffStat, FileStatus } from '../../services/workspace/types.js'

export type FileNode = {
  name: string
  path: string
  kind: 'file' | 'dir'
  children: FileNode[]
  status?: FileStatus
  additions?: number
  deletions?: number
}

/** 把扁平变更列表折叠成目录树，目录排在文件前 */
export const buildFileTree = (items: FileDiffStat[]): FileNode[] => {
  const root: FileNode = { name: '', path: '', kind: 'dir', children: [] }

  for (const item of items) {
    const parts = item.path.split('/')
    let cursor = root
    parts.forEach((part, index) => {
      const last = index === parts.length - 1
      const path = parts.slice(0, index + 1).join('/')
      let next = cursor.children.find((child) => child.name === part)
      if (!next) {
        next = {
          name: part,
          path,
          kind: last ? 'file' : 'dir',
          children: [],
        }
        cursor.children.push(next)
      }
      if (last) {
        next.status = item.status
        next.additions = item.additions
        next.deletions = item.deletions
      }
      cursor = next
    })
  }

  const sort = (nodes: FileNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === 'dir' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) {
      sort(node.children)
    }
  }
  sort(root.children)
  return root.children
}

/**
 * 全量文件树：把所有文件都列出来，改动状态只是标记。
 *
 * 给工作区面板用——只列"变更文件"的话，13 个文件里改过的 3 个之外
 * 全都看不见，用户没法像文件管理器那样浏览自己的工作区。
 */
export const buildFullFileTree = (
  files: Record<string, string>,
  stats: Map<string, FileDiffStat>
): FileNode[] => {
  const root: FileNode = { name: '', path: '', kind: 'dir', children: [] }

  for (const path of Object.keys(files)) {
    const stat = stats.get(path)
    const parts = path.split('/')
    let cursor = root
    parts.forEach((part, index) => {
      const last = index === parts.length - 1
      const full = parts.slice(0, index + 1).join('/')
      let next = cursor.children.find((child) => child.name === part)
      if (!next) {
        next = {
          name: part,
          path: full,
          kind: last ? 'file' : 'dir',
          children: [],
        }
        cursor.children.push(next)
      }
      if (last && stat) {
        next.status = stat.status
        next.additions = stat.additions
        next.deletions = stat.deletions
      }
      cursor = next
    })
  }

  const sort = (nodes: FileNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === 'dir' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) {
      sort(node.children)
    }
  }
  sort(root.children)
  return root.children
}

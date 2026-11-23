import { diffLines } from 'diff'
import { sortPaths, type FileDiffStat, type FileStatus } from './types.js'

export type FileDiff = {
  path: string
  status: FileStatus
  additions: number
  deletions: number
  original: string
  modified: string
}

/** 单个文件相对基线的差异与行数统计 */
export const diffFile = (
  path: string,
  base: Record<string, string>,
  files: Record<string, string>
): FileDiff => {
  const before = base[path]
  const after = files[path]
  if (before === undefined && after === undefined) {
    return { path, status: 'unchanged', additions: 0, deletions: 0, original: '', modified: '' }
  }
  if (before === undefined) {
    const lines = countLines(after ?? '')
    return {
      path,
      status: 'added',
      additions: lines,
      deletions: 0,
      original: '',
      modified: after ?? '',
    }
  }
  if (after === undefined) {
    const lines = countLines(before)
    return {
      path,
      status: 'deleted',
      additions: 0,
      deletions: lines,
      original: before,
      modified: '',
    }
  }
  if (before === after) {
    return { path, status: 'unchanged', additions: 0, deletions: 0, original: before, modified: after }
  }

  let additions = 0
  let deletions = 0
  for (const change of diffLines(before, after)) {
    const lines = countLines(change.value)
    if (change.added) {
      additions += lines
    } else if (change.removed) {
      deletions += lines
    }
  }
  return { path, status: 'modified', additions, deletions, original: before, modified: after }
}

/** 全部有变化的文件，按路径排序 */
export const diffWorkspace = (
  base: Record<string, string>,
  files: Record<string, string>
): FileDiff[] => {
  const paths = sortPaths([...new Set([...Object.keys(base), ...Object.keys(files)])])
  return paths
    .map((path) => diffFile(path, base, files))
    .filter((item) => item.status !== 'unchanged')
}

/** 文件树上的变更标记 */
export const workspaceStats = (
  base: Record<string, string>,
  files: Record<string, string>
): Map<string, FileDiffStat> => {
  const map = new Map<string, FileDiffStat>()
  for (const item of diffWorkspace(base, files)) {
    map.set(item.path, {
      path: item.path,
      status: item.status,
      additions: item.additions,
      deletions: item.deletions,
    })
  }
  return map
}

/** 汇总新增与删除行数 */
export const totalChanges = (list: FileDiffStat[]) =>
  list.reduce(
    (sum, item) => ({ additions: sum.additions + item.additions, deletions: sum.deletions + item.deletions }),
    { additions: 0, deletions: 0 }
  )

/** 行数：空内容算 0 行，末尾换行不额外计一行 */
export const countLines = (text: string) => {
  if (!text) {
    return 0
  }
  const normalized = text.endsWith('\n') ? text.slice(0, -1) : text
  return normalized.split('\n').length
}

/** 生成统一 diff 文本，供模型阅读或复制 */
export const unifiedDiff = (item: FileDiff) => {
  const header = [
    `--- ${item.status === 'added' ? '/dev/null' : `a/${item.path}`}`,
    `+++ ${item.status === 'deleted' ? '/dev/null' : `b/${item.path}`}`,
  ]
  const body: string[] = []
  let beforeLine = 1
  let afterLine = 1
  for (const change of diffLines(item.original, item.modified)) {
    const lines = change.value.split('\n')
    if (lines.at(-1) === '') {
      lines.pop()
    }
    if (change.added) {
      body.push(
        `@@ -${beforeLine},0 +${afterLine},${lines.length} @@`,
        ...lines.map((line) => `+${line}`)
      )
      afterLine += lines.length
    } else if (change.removed) {
      body.push(
        `@@ -${beforeLine},${lines.length} +${afterLine},0 @@`,
        ...lines.map((line) => `-${line}`)
      )
      beforeLine += lines.length
    } else {
      body.push(`@@ -${beforeLine},${lines.length} +${afterLine},${lines.length} @@`)
      body.push(...lines.map((line) => ` ${line}`))
      beforeLine += lines.length
      afterLine += lines.length
    }
  }
  return [...header, ...body].join('\n')
}

import type { TranslationKey } from '../../i18n/index.js'
import type { ToolCallPart, ToolResultPart } from '../../services/chat/types.js'

/**
 * 工具行的「一句话状态」。
 *
 * agent 写的 purpose 说明「要做什么」，这里补「做成了什么」：
 * 已编辑 ChatInput.tsx、已读取 42 行、已执行 · 退出码 0。
 *
 * 数据来源优先级：工具返回的 meta > 工具名推断 > 空。
 * 不去正则猜结果正文——猜错了比不显示更糟。
 */

export type ChangeInfo = { path: string; additions: number; deletions: number }

export type ToolStatus = {
  /** 动词；为空表示这行不需要状态文案 */
  verb: TranslationKey | null
  /** 目标：文件名、计数或补充说明 */
  target: string
  /** 文件改动的增删行数，点开直接看 diff */
  change: ChangeInfo | null
}

const empty: ToolStatus = { verb: null, target: '', change: null }

const baseName = (path: string) => {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** 写文件类工具：统一按「编辑」呈现，增删行数来自 meta */
const readChange = (meta: Record<string, unknown> | undefined): ChangeInfo | null => {
  if (!meta) {
    return null
  }
  const path = text(meta.path)
  const additions = count(meta.additions)
  const deletions = count(meta.deletions)
  if (!path || (additions === null && deletions === null)) {
    return null
  }
  return { path, additions: additions ?? 0, deletions: deletions ?? 0 }
}

const VERBS: { test: (name: string) => boolean; verb: TranslationKey }[] = [
  { test: (name) => /(?:^|_)(?:write|edit|patch|replace|append)/.test(name), verb: 'toolVerbEdited' },
  { test: (name) => /(?:^|_)create/.test(name), verb: 'toolVerbCreated' },
  { test: (name) => /(?:^|_)(?:read|cat|head|tail)(?:_|$)/.test(name), verb: 'toolVerbRead' },
  { test: (name) => /(?:^|_)list/.test(name), verb: 'toolVerbListed' },
  { test: (name) => /(?:grep|search|find|query)/.test(name), verb: 'toolVerbSearched' },
  { test: (name) => /(?:shell|exec|command|python|run|script)/.test(name), verb: 'toolVerbRan' },
  { test: (name) => /(?:fetch|read_url|http|download|browse)/.test(name), verb: 'toolVerbFetched' },
  { test: (name) => /(?:screenshot|capture|snapshot|image)/.test(name), verb: 'toolVerbCaptured' },
  { test: (name) => /(?:hash|encode|decode|json|transform|convert)/.test(name), verb: 'toolVerbProcessed' },
]

const detectVerb = (name: string): TranslationKey => {
  const lower = name.toLowerCase()
  for (const entry of VERBS) {
    if (entry.test(lower)) {
      return entry.verb
    }
  }
  return 'toolVerbDone'
}

/** 从输入里挑一个最能代表这次调用的目标：文件名、命令、查询词 */
const pickTarget = (input: unknown, fallbackPath: string) => {
  if (fallbackPath) {
    return baseName(fallbackPath)
  }
  if (!input || typeof input !== 'object') {
    return ''
  }
  const record = input as Record<string, unknown>
  for (const key of ['path', 'file', 'filename', 'target']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return baseName(value.trim())
    }
  }
  for (const key of ['query', 'pattern', 'command', 'url', 'name']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      const trimmed = value.trim().replace(/\s+/g, ' ')
      return trimmed.length > 32 ? `${trimmed.slice(0, 32)}…` : trimmed
    }
  }
  return ''
}

export const describeToolStatus = (call: ToolCallPart, result?: ToolResultPart): ToolStatus => {
  if (call.status === 'pending' || call.status === 'running' || call.status === 'awaiting') {
    return empty
  }
  if (call.status === 'denied') {
    return { verb: 'toolVerbDenied', target: '', change: null }
  }
  if (call.status === 'error' || result?.isError) {
    return { verb: 'toolVerbFailed', target: '', change: null }
  }

  const meta = result?.meta
  const change = readChange(meta)
  // 工具自己给的一句话最准，优先用
  const summary = text(meta?.summary)
  if (summary) {
    return { verb: null, target: summary, change }
  }

  const verb = detectVerb(call.name)
  const target = pickTarget(call.input, change?.path ?? text(meta?.path))
  return { verb, target, change }
}

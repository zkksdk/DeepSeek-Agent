/**
 * 智能体长期记忆：跨会话保存用户偏好与事实，请求时注入系统提示词。
 *
 * 设计：
 * - 纯本地存储（平台适配层），不经过任何服务器；
 * - 显式记忆：模型可调用 remember_fact / forget_fact 主动增删；
 * - 注入策略：拼接进 system prompt，按字数上限截断，避免挤占上下文。
 */
import { storage } from '../platform/storage.js'

export type MemoryItem = {
  id: string
  content: string
  createdAt: number
  /** 所属工作区；undefined 为全局记忆（默认工作区也视为全局） */
  workspaceId?: string
}

const MEMORY_KEY = 'chat-demo:agent-memory'
/** 注入上限：超过则优先保留最新的记忆 */
const MAX_PROMPT_CHARS = 2000

export const readMemories = (): MemoryItem[] => {
  const raw = storage.getJSON<unknown>(MEMORY_KEY, [])
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .filter(
      (item): item is MemoryItem =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as MemoryItem).id === 'string' &&
        typeof (item as MemoryItem).content === 'string'
    )
    .map((item) => ({
      id: item.id,
      content: item.content,
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0,
      workspaceId: typeof item.workspaceId === 'string' ? item.workspaceId : undefined,
    }))
}

const save = (items: MemoryItem[]) => {
  storage.setJSON(MEMORY_KEY, items)
}

/** 新增一条记忆；重复内容直接返回已有项 */
export const addMemory = (content: string, workspaceId?: string): MemoryItem | null => {
  const trimmed = content.trim()
  if (!trimmed) {
    return null
  }
  const items = readMemories()
  const existing = items.find((item) => item.content === trimmed)
  if (existing) {
    return existing
  }
  const item: MemoryItem = {
    id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    content: trimmed.slice(0, 500),
    createdAt: Date.now(),
    ...(workspaceId && workspaceId !== 'default' ? { workspaceId } : {}),
  }
  save([item, ...items])
  return item
}

/** 修改一条记忆的内容；返回是否成功 */
export const updateMemory = (id: string, content: string): boolean => {
  const trimmed = content.trim()
  if (!trimmed) {
    return false
  }
  const items = readMemories()
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) {
    return false
  }
  const next = [...items]
  next[index] = { ...next[index], content: trimmed.slice(0, 500) }
  save(next)
  return true
}

/** 按 id 或内容精确匹配删除，返回删除条数 */
export const removeMemory = (target: string): number => {
  const items = readMemories()
  const next = items.filter((item) => item.id !== target && item.content !== target)
  const removed = items.length - next.length
  if (removed > 0) {
    save(next)
  }
  return removed
}

export const clearMemories = () => {
  save([])
}

/** 文本的字符 bigram 集合（中文友好，无需分词） */
const bigrams = (text: string): Set<string> => {
  const normalized = text.toLowerCase().replace(/\s+/g, '')
  const set = new Set<string>()
  for (let i = 0; i < normalized.length - 1; i += 1) {
    set.add(normalized.slice(i, i + 2))
  }
  return set
}

/** Jaccard 相似度 */
const similarity = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) {
    return 0
  }
  let intersection = 0
  for (const gram of a) {
    if (b.has(gram)) {
      intersection += 1
    }
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * 合并相似记忆：相似度超过阈值的只保留信息量更大（更长）的一条。
 * 返回被合并掉的条数。
 */
export const mergeSimilarMemories = (threshold = 0.72): number => {
  const items = readMemories()
  const kept: MemoryItem[] = []
  let removed = 0
  for (const item of items) {
    const grams = bigrams(item.content)
    const index = kept.findIndex((entry) => similarity(grams, bigrams(entry.content)) >= threshold)
    if (index < 0) {
      kept.push(item)
      continue
    }
    removed += 1
    // 保留更长的内容，但沿用先出现那条的 id 与时间，避免列表跳动
    const existing = kept[index]
    if (item.content.length > existing.content.length) {
      kept[index] = { ...existing, content: item.content }
    }
  }
  if (removed > 0) {
    save(kept)
  }
  return removed
}

/** 提取查询词：英文/数字按词切，中文取相邻两字（bigram） */
const extractTerms = (query: string): string[] => {
  const terms = new Set<string>()
  const normalized = query.toLowerCase()
  for (const word of normalized.split(/[^a-z0-9\u4e00-\u9fa5]+/)) {
    if (word.length >= 2) {
      terms.add(word)
    }
  }
  // 中文 bigram：只在中文串上滑动，避免跨标点
  for (const chunk of normalized.match(/[\u4e00-\u9fa5]+/g) ?? []) {
    if (chunk.length === 1) {
      continue
    }
    for (let i = 0; i < chunk.length - 1; i += 1) {
      terms.add(chunk.slice(i, i + 2))
    }
  }
  return [...terms]
}

/** 记忆与查询的相关度：命中词越多越长越相关 */
const scoreMemory = (content: string, terms: string[]): number => {
  const haystack = content.toLowerCase()
  let score = 0
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += term.length >= 3 ? 2 : 1
    }
  }
  return score
}

/**
 * 生成注入 system prompt 的记忆片段：
 * - 传入 query 时按相关度召回 Top 8，不足时用最新记忆补齐；
 * - 未传 query 时取最新 12 条；
 * - 总字数上限 2000。
 * 无记忆时返回空串。
 */
export const buildMemoryPrompt = (
  query?: string,
  workspaceId?: string,
  spark = false
): string => {
  const all = readMemories()
  // 记忆隔离：全局记忆（无归属）始终可见，其余只看当前工作区的
  const items = all.filter(
    (item) => !item.workspaceId || !workspaceId || item.workspaceId === workspaceId
  )
  if (items.length === 0) {
    return ''
  }
  let selected = items
  const terms = query ? extractTerms(query) : []
  if (terms.length > 0 && items.length > 8) {
    const scored = items
      .map((item) => ({ item, score: scoreMemory(item.content, terms) }))
      .sort((a, b) => b.score - a.score)
    const hits = scored.filter((entry) => entry.score > 0).slice(0, 8).map((entry) => entry.item)
    const rest = items.filter((item) => !hits.includes(item)).slice(0, Math.max(0, 8 - hits.length))
    selected = [...hits, ...rest]
  } else {
    selected = items.slice(0, 12)
  }

  const lines: string[] = []
  let used = 0
  for (const item of selected) {
    const line = `- ${item.content}`
    if (used + line.length > MAX_PROMPT_CHARS) {
      break
    }
    lines.push(line)
    used += line.length
  }
  if (lines.length === 0) {
    return ''
  }
  // 随机联想：从本次未召回的记忆里抽一条，像人突然想起点什么
  let sparkText = ''
  if (spark) {
    const selectedSet = new Set(selected.map((item) => item.id))
    const remaining = items.filter((item) => !selectedSet.has(item.id))
    if (remaining.length > 0 && Math.random() < 0.35) {
      const pick = remaining[Math.floor(Math.random() * remaining.length)]
      sparkText = `\n\n## 顺手想起的一条旧记忆（可能不相关）\n- ${pick.content}\n若与当前话题相关且自然，可顺便提及；不相关就忽略，不要硬提。`
    }
  }
  return `\n\n## 关于用户的长期记忆\n以下是此前记住的信息，回答时参考但不要机械复述：\n${lines.join('\n')}${sparkText}`
}

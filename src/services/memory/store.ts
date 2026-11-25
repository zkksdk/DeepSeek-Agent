import { create } from 'zustand'
import * as db from '../chat/db.js'
import type { StoredMemory } from '../chat/db.js'
import { useWorkspace } from '../workspace/store.js'

/**
 * 长期记忆。
 *
 * 分层只有一个理由：token。索引（一行摘要）每轮进 system prompt，
 * 正文只在模型主动 recall 时才读。这样记一百条和记十条，每轮成本几乎一样。
 *
 * 上限照抄 Claude Code 的 auto memory：它给 MEMORY.md 定的是 200 行 / 25KB。
 * 手机上下文更贵，这里收到 40 条 / 2000 字符。
 */

/** 索引最多塞多少条 */
export const MEMORY_INDEX_LIMIT = 40
/** 索引最多多少字符 */
export const MEMORY_CHAR_LIMIT = 2000

const TYPE_LABEL: Record<StoredMemory['type'], string> = {
  user: '用户',
  feedback: '纠正',
  project: '项目',
  reference: '参考',
}

type MemoryState = {
  ready: boolean
  list: StoredMemory[]
}

export const useMemory = create<MemoryState>(() => ({
  ready: false,
  list: [],
}))

/** 按「用过几次 → 最近更新」排序，越靠前越该留 */
const rank = (a: StoredMemory, b: StoredMemory) => b.hits - a.hits || b.updatedAt - a.updatedAt

export const loadAll = async (): Promise<void> => {
  const list = await db.loadMemories()
  list.sort(rank)
  useMemory.setState({ ready: true, list })
}

export const add = async (input: {
  type: StoredMemory['type']
  title: string
  body: string
  workspaceId?: string
}): Promise<StoredMemory> => {
  const now = Date.now()
  const memory: StoredMemory = {
    id: 'mem_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    type: input.type,
    title: input.title.trim().slice(0, 120),
    body: input.body.trim().slice(0, 4000),
    createdAt: now,
    updatedAt: now,
    hits: 0,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
  }
  await db.saveMemory(memory)
  const list = [...useMemory.getState().list, memory].sort(rank)
  useMemory.setState({ list })
  return memory
}

export const update = async (
  id: string,
  patch: Partial<Pick<StoredMemory, 'title' | 'body' | 'type'>>
): Promise<void> => {
  const current = useMemory.getState().list.find((item) => item.id === id)
  if (!current) {
    return
  }
  const next: StoredMemory = { ...current, ...patch, updatedAt: Date.now() }
  await db.saveMemory(next)
  useMemory.setState({
    list: useMemory.getState().list.map((item) => (item.id === id ? next : item)).sort(rank),
  })
}

export const remove = async (id: string): Promise<void> => {
  await db.deleteMemory(id)
  useMemory.setState({ list: useMemory.getState().list.filter((item) => item.id !== id) })
}

/**
 * 拼出注入 system prompt 的索引块。
 *
 * 每条只占一行，正文不进来。超限从尾部（最少用、最旧）开始丢，
 * 保证这段长度是常数，不随记忆条数膨胀。
 */
export const memoryPrompt = (): string => {
  // 全局记忆 + 当前工作区专属的记忆。别的项目的约定不该混进来——
  // 「这个仓库用 pnpm」放到另一个仓库就是错的信息。
  const activeWorkspace = useWorkspace.getState().activeId
  const list = useMemory
    .getState()
    .list.filter((item) => !item.workspaceId || item.workspaceId === activeWorkspace)
  if (list.length === 0) {
    return ''
  }
  const lines: string[] = []
  let used = 0
  for (const memory of list) {
    if (lines.length >= MEMORY_INDEX_LIMIT) {
      break
    }
    const line = '- [' + TYPE_LABEL[memory.type] + '] ' + memory.title
    if (used + line.length > MEMORY_CHAR_LIMIT) {
      break
    }
    lines.push(line)
    used += line.length
  }
  if (lines.length === 0) {
    return ''
  }
  return [
    '',
    '长期记忆（过往会话里确认过的事；和当前指令冲突时以当前指令为准）：',
    ...lines,
    '需要细节用 recall_memory 查，不要凭标题猜内容。',
  ].join('\n')
}

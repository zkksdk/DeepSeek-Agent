import { create } from 'zustand'
import type { MessageUsage } from '../api/types.js'

/**
 * 上下文占用：记录每个会话最近一次请求的完整上下文大小。
 *
 * message_start 上报的 input + cache_read + cache_creation 就是本次请求真正发出去的
 * 上下文体量（含命中缓存的部分），比按字符估算准确，所以只认服务端数值。
 * 数值按会话存到 localStorage，刷新页面后仍能看到上次的占用。
 */

const WINDOW: Record<string, number> = {
  'deepseek-flash': 1_000_000,
  'deepseek-v4-pro': 1_000_000,
}

/** 接口没有给出上下文窗口时按 1M 兜底 */
const FALLBACK_WINDOW = 1_000_000

export const contextWindowFor = (model: string): number => WINDOW[model] ?? FALLBACK_WINDOW

const CACHE_KEY = 'chat-agent:context-usage'
/** 只保留最近 200 个会话，避免键无限增长 */
const MAX_ENTRIES = 200

type Usage = { tokens: number; at: number }
type ContextState = { byId: Record<string, Usage> }

const readCache = (): Record<string, Usage> => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) {
      return {}
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return {}
    }
    const result: Record<string, Usage> = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = value as Partial<Usage> | null
      if (typeof entry?.tokens === 'number' && typeof entry.at === 'number') {
        result[id] = { tokens: entry.tokens, at: entry.at }
      }
    }
    return result
  } catch {
    return {}
  }
}

const writeCache = (byId: Record<string, Usage>) => {
  try {
    const entries = Object.entries(byId).sort((a, b) => b[1].at - a[1].at)
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, MAX_ENTRIES))))
  } catch {
    // 隐私模式下写不进去也不影响本次显示
  }
}

export const useContextUsage = create<ContextState>(() => ({ byId: readCache() }))

/** 一轮请求开始时记下它的上下文大小；同一会话只保留最新值 */
export const noteContextUsage = (sessionId: string, usage: MessageUsage | undefined) => {
  if (!usage) {
    return
  }
  const tokens =
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  if (tokens <= 0) {
    return
  }
  const previous = useContextUsage.getState().byId[sessionId]
  if (previous && previous.tokens === tokens) {
    return
  }
  const byId = { ...useContextUsage.getState().byId, [sessionId]: { tokens, at: Date.now() } }
  useContextUsage.setState({ byId })
  writeCache(byId)
}

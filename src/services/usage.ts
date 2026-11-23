import { create } from 'zustand'
import {
  dayKey,
  estimateCost,
  monthKey,
  normalizePricingModel,
  type PricingModel,
  type TokenUsage,
} from './pricing.js'

/**
 * 本地用量账本。
 *
 * 聊天记录可能被导入/删除，但花费不应该跟着丢，所以单独存一份轻量账本：
 * 只记录每天各类 token 与按官方价估算的金额，不记录任何对话内容。
 * 首次使用从 0 开始；预算默认 100 元，可在设置里修改。
 */

export type DayUsage = {
  /** 估算花费（人民币元） */
  cost: number
  /** 缓存命中输入 tokens */
  hit: number
  /** 缓存未命中输入 tokens */
  miss: number
  /** 输出 tokens */
  output: number
  /** 请求轮次 */
  requests: number
  /** 当天用到的模型 */
  models: Record<string, number>
}

export type UsageState = {
  /** 预算（人民币元） */
  budget: number
  /** 按北京时间的日期分桶 */
  days: Record<string, DayUsage>
  /** 累计花费 */
  totalCost: number
  /** 累计 tokens */
  totalTokens: number
  /** 累计请求轮次 */
  totalRequests: number
}

const STORAGE_KEY = 'chat-agent:usage-ledger'
const MAX_DAYS = 180
const DEFAULT_BUDGET = 100

export const EMPTY_DAY: DayUsage = {
  cost: 0,
  hit: 0,
  miss: 0,
  output: 0,
  requests: 0,
  models: {},
}

const isDayUsage = (value: unknown): value is DayUsage => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    typeof record.cost === 'number' &&
    typeof record.hit === 'number' &&
    typeof record.miss === 'number' &&
    typeof record.output === 'number'
  )
}

const load = (): UsageState => {
  const fallback: UsageState = {
    budget: DEFAULT_BUDGET,
    days: {},
    totalCost: 0,
    totalTokens: 0,
    totalRequests: 0,
  }
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object') {
      return fallback
    }
    const record = parsed as Record<string, unknown>
    const days: Record<string, DayUsage> = {}
    const cutoff = Date.now() - MAX_DAYS * 86_400_000
    if (record.days && typeof record.days === 'object') {
      for (const [key, value] of Object.entries(record.days as Record<string, unknown>)) {
        if (!isDayUsage(value)) {
          continue
        }
        const stamp = Date.parse(`${key}T00:00:00+08:00`)
        if (Number.isFinite(stamp) && stamp >= cutoff) {
          days[key] = {
            ...EMPTY_DAY,
            ...value,
            models:
              value.models && typeof value.models === 'object'
                ? (value.models as Record<string, number>)
                : {},
          }
        }
      }
    }
    return {
      budget:
        typeof record.budget === 'number' && record.budget > 0 ? record.budget : DEFAULT_BUDGET,
      days,
      totalCost: typeof record.totalCost === 'number' ? record.totalCost : 0,
      totalTokens: typeof record.totalTokens === 'number' ? record.totalTokens : 0,
      totalRequests: typeof record.totalRequests === 'number' ? record.totalRequests : 0,
    }
  } catch {
    return fallback
  }
}

const persist = (state: UsageState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 存储不可用时只在内存里累计
  }
}

export const useUsage = create<UsageState>(() => load())

const save = (next: UsageState) => {
  persist(next)
  useUsage.setState(next)
}

export const setBudget = (budget: number) => {
  const value = Number.isFinite(budget) ? Math.min(1_000_000, Math.max(0.01, budget)) : DEFAULT_BUDGET
  save({ ...useUsage.getState(), budget: Math.round(value * 100) / 100 })
}

export const resetUsage = () => {
  save({
    budget: useUsage.getState().budget,
    days: {},
    totalCost: 0,
    totalTokens: 0,
    totalRequests: 0,
  })
}

/** 一轮请求结束时记账；input 与 output 分两次事件到达，因此允许部分字段为 0 */
export const recordUsage = (
  input: { model?: string; cacheHit?: number; cacheMiss?: number; output?: number; at?: number },
  phase: 'input' | 'output'
) => {
  const cacheHit = Math.max(0, Math.round(input.cacheHit ?? 0))
  const cacheMiss = Math.max(0, Math.round(input.cacheMiss ?? 0))
  const output = Math.max(0, Math.round(input.output ?? 0))
  if (cacheHit + cacheMiss + output === 0) {
    return
  }
  const at = new Date(input.at ?? Date.now())
  const model = normalizePricingModel(input.model)
  const usage: TokenUsage = { cacheHit, cacheMiss, output }
  const cost = estimateCost(model, usage, at)
  const key = dayKey(at)
  const state = useUsage.getState()
  const day = state.days[key] ?? EMPTY_DAY
  const models = { ...day.models }
  models[model] = (models[model] ?? 0) + 1
  const nextDay: DayUsage = {
    cost: day.cost + cost,
    hit: day.hit + cacheHit,
    miss: day.miss + cacheMiss,
    output: day.output + output,
    requests: day.requests + (phase === 'output' ? 1 : 0),
    models,
  }
  const days: Record<string, DayUsage> = { ...state.days, [key]: nextDay }
  // 控制体积：只留最近 180 天（避免动态 delete 让对象进入字典模式）
  const keys = Object.keys(days).sort()
  const trimmed =
    keys.length > MAX_DAYS
      ? Object.fromEntries(keys.slice(keys.length - MAX_DAYS).map((item) => [item, days[item]]))
      : days
  save({
    ...state,
    days: trimmed,
    totalCost: state.totalCost + cost,
    totalTokens: state.totalTokens + cacheHit + cacheMiss + output,
    totalRequests: state.totalRequests + (phase === 'output' ? 1 : 0),
  })
}

export const todayUsage = (state: UsageState): DayUsage => state.days[dayKey()] ?? EMPTY_DAY

/** 当月花费：只汇总当前北京月份的桶 */
export const monthUsage = (state: UsageState): { cost: number; tokens: number; models: number } => {
  const prefix = monthKey()
  let cost = 0
  let tokens = 0
  const models = new Set<string>()
  for (const [key, day] of Object.entries(state.days)) {
    if (!key.startsWith(prefix)) {
      continue
    }
    cost += day.cost
    tokens += day.hit + day.miss + day.output
    for (const model of Object.keys(day.models)) {
      models.add(model)
    }
  }
  return { cost, tokens, models: models.size }
}

export const modelLabel = (model: PricingModel | string): string =>
  model.includes('pro') ? 'V4 Pro' : 'V4.1 Flash'

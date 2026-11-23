import { API_ORIGIN } from './client.js'

/** 模型选项：远端拉取的排在内置列表之前，来源用于界面提示 */
export type ModelOption = {
  id: string
  label: string
  source: 'remote' | 'builtin'
}

/** 服务不可达或 Key 无效时的兜底列表，保证选择器永远可用 */
export const BUILTIN_MODELS: ModelOption[] = [
  { id: 'deepseek-flash', label: 'DeepSeek Flash', source: 'builtin' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', source: 'builtin' },
]

const CACHE_KEY = 'chat-agent:models-cache'
/** 缓存一小时；刷新按钮会强制重新拉取 */
const CACHE_TTL = 60 * 60 * 1000
/** 单次请求超时，避免网络挂起时选择器一直转圈 */
const FETCH_TIMEOUT = 8000

type Cached = { at: number; models: ModelOption[] }

/** 把 deepseek-v4-pro 之类的 id 整理成可读名称，远端没给 display_name 时使用 */
export const prettyModelName = (id: string): string =>
  id
    .split(/[-_/]/)
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join(' ')

export const modelLabel = (id: string): string =>
  BUILTIN_MODELS.find((item) => item.id === id)?.label ?? prettyModelName(id)

export const readCachedModels = (): ModelOption[] | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Cached
    if (!Array.isArray(parsed.models) || Date.now() - parsed.at > CACHE_TTL) {
      return null
    }
    return parsed.models.filter((item) => typeof item?.id === 'string')
  } catch {
    return null
  }
}

const writeCache = (models: ModelOption[]) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), models }))
  } catch {
    // 隐私模式下写入失败不影响本次选择
  }
}

/** 兼容 OpenAI 的 {data:[{id}]} 与部分实现的 {models:[...]} */
const parseModels = (payload: unknown): ModelOption[] => {
  if (typeof payload !== 'object' || payload === null) {
    return []
  }
  const record = payload as Record<string, unknown>
  const list = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : []
  const seen = new Set<string>()
  return list.flatMap((item): ModelOption[] => {
    if (typeof item === 'string') {
      return [{ id: item, label: prettyModelName(item), source: 'remote' as const }]
    }
    if (typeof item !== 'object' || item === null) {
      return []
    }
    const entry = item as Record<string, unknown>
    const id =
      typeof entry.id === 'string' ? entry.id : typeof entry.name === 'string' ? entry.name : ''
    if (!id || seen.has(id)) {
      return []
    }
    seen.add(id)
    const label =
      (typeof entry.display_name === 'string' && entry.display_name) ||
      (typeof entry.displayName === 'string' && entry.displayName) ||
      prettyModelName(id)
    return [{ id, label, source: 'remote' as const }]
  })
}

const requestJson = async (url: string, headers: Record<string, string>): Promise<unknown> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    const response = await fetch(url, { headers, signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 远端拉取可用模型。
 * 先试 OpenAI 兼容的 /models，再试 Anthropic 兼容前缀，任一成功即返回；
 * 都失败时抛出最后一次错误，由调用方退回缓存或内置列表。
 */
export const fetchRemoteModels = async (apiKey: string): Promise<ModelOption[]> => {
  if (!apiKey.trim()) {
    throw new Error('missing api key')
  }
  const attempts: Array<() => Promise<unknown>> = [
    () =>
      requestJson(`${API_ORIGIN}/models`, {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      }),
    () =>
      requestJson(`${API_ORIGIN}/anthropic/v1/models`, {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        Accept: 'application/json',
      }),
  ]
  let lastError: unknown = new Error('no endpoint')
  for (const attempt of attempts) {
    try {
      const models = parseModels(await attempt())
      if (models.length > 0) {
        writeCache(models)
        return models
      }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

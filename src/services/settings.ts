import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'
import { storage } from './platform/storage.js'
import { persistApiKey, readApiKey } from './platform/secureStore.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：API Key、模型、API 地址、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  apiKey: string | null
  /** 当前模型名，可自定义为服务端支持的任意模型 */
  model: string
  /** 自定义 API 基础地址；空串表示使用构建期默认地址 */
  apiOrigin: string
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  /** 智能体模式：允许模型调用本地工具并自主循环 */
  agentMode: boolean
  /** 每轮结束后自动整理记忆 */
  autoMemory: boolean
  /** 随机联想：偶尔注入一条未被召回的记忆 */
  memorySpark: boolean
  /** 工具开关覆盖：未出现的工具默认启用，false 表示禁用 */
  toolOverrides: Record<string, boolean>
  siderCollapsed: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  model: 'chat-demo:model',
  apiOrigin: 'chat-demo:api-origin',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  agentMode: 'chat-demo:agent-mode',
  autoMemory: 'chat-demo:auto-memory',
  memorySpark: 'chat-demo:memory-spark',
  toolOverrides: 'chat-demo:tool-overrides',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => storage.get(key)

const write = (key: string, value: string | null) => storage.set(key, value)

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 未保存过时使用服务端默认模型 deepseek-flash */
export const DEFAULT_MODEL = 'deepseek-flash'
const initialModel = (): string => (read(KEYS.model) ?? '').trim() || DEFAULT_MODEL
/** 未保存过时为空串，表示使用构建期默认 API 地址 */
const initialApiOrigin = (): string => (read(KEYS.apiOrigin) ?? '').trim()

/** 未保存过时为空对象，表示所有工具默认启用 */
const initialToolOverrides = (): Record<string, boolean> => {
  try {
    const parsed = JSON.parse(read(KEYS.toolOverrides) ?? '{}') as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    const result: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') {
        result[key] = value
      }
    }
    return result
  } catch {
    return {}
  }
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  model: initialModel(),
  apiOrigin: initialApiOrigin(),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  agentMode: read(KEYS.agentMode) === 'true',
  autoMemory: read(KEYS.autoMemory) !== 'false',
  memorySpark: read(KEYS.memorySpark) !== 'false',
  toolOverrides: initialToolOverrides(),
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

/** 保存自定义模型名；空值视为恢复默认模型 */
export const setModel = (model: string) => {
  const value = model.trim() || DEFAULT_MODEL
  write(KEYS.model, value === DEFAULT_MODEL ? null : value)
  useSettings.setState({ model: value })
}

/** 保存自定义 API 基础地址；空值视为使用默认地址 */
export const setApiOrigin = (apiOrigin: string) => {
  const value = apiOrigin.trim()
  write(KEYS.apiOrigin, value || null)
  useSettings.setState({ apiOrigin: value })
}

/** 智能体模式开关 */
export const setAgentMode = (agentMode: boolean) => {
  write(KEYS.agentMode, agentMode ? 'true' : null)
  useSettings.setState({ agentMode })
}

/** 自动记忆开关（默认开启） */
export const setAutoMemory = (autoMemory: boolean) => {
  write(KEYS.autoMemory, autoMemory ? null : 'false')
  useSettings.setState({ autoMemory })
}

/** 随机联想开关（默认开启） */
export const setMemorySpark = (memorySpark: boolean) => {
  write(KEYS.memorySpark, memorySpark ? null : 'false')
  useSettings.setState({ memorySpark })
}

/** 启用/禁用一个工具；禁用时记 false，启用时移除覆盖回到默认启用 */
export const setToolEnabled = (name: string, enabled: boolean) => {
  const next = { ...useSettings.getState().toolOverrides }
  if (enabled) {
    delete next[name]
  } else {
    next[name] = false
  }
  write(KEYS.toolOverrides, Object.keys(next).length ? JSON.stringify(next) : null)
  useSettings.setState({ toolOverrides: next })
}

/** 工具是否启用 */
export const isToolEnabled = (name: string): boolean =>
  useSettings.getState().toolOverrides[name] !== false

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  // 统一走凭证适配层：Web 落 localStorage，原生壳换系统钥匙串
  void persistApiKey(apiKey)
  useSettings.setState({ apiKey })
}

/** 启动时异步校准凭证（原生壳下钥匙串读取是异步的） */
export const hydrateApiKey = async () => {
  const stored = await readApiKey()
  if (stored !== useSettings.getState().apiKey) {
    useSettings.setState({ apiKey: stored })
  }
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

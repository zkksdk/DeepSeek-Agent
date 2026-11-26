import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'
import { migrateSystemPrompt } from './systemPrompt.js'

export type Locale = 'zh-CN' | 'en-US'

/** 逐项动效开关：关掉哪一项就少一类动画，便于在低配机器上只保留必要反馈 */
export type AnimSettings = {
  /** 背景极光光斑 */
  aurora: boolean
  /** 标题与状态文字的流光 */
  shimmer: boolean
  /** 面板、卡片、弹层的过渡 */
  transitions: boolean
  /** 工具执行的扫描线与脉冲 */
  pulse: boolean
}

export const DEFAULT_ANIM: AnimSettings = {
  aurora: true,
  shimmer: true,
  transitions: true,
  pulse: true,
}

/** 底部状态条 token 的统计方式：fast 用字符权重估算，exact 用 DeepSeek BPE 词表精确切分 */
export type TokenCounterMode = 'fast' | 'exact'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 视觉风格：calm 中性克制（默认），aurora 保留原来的极光背景 */
export type LookPreference = 'calm' | 'aurora'

/** 玻璃强度：liquid 折射液态玻璃，frost 普通毛玻璃，off 纯色 */
export type GlassPreference = 'liquid' | 'frost' | 'off'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  /** 长任务在后台完成时发系统通知 */
  notifyOnDone: boolean
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  /** 当前模型；远端拉取的模型 id 直接存放 */
  model: string
  thinking: boolean
  /** 思考强度 0-4，0 为关闭；与 thinking 保持同步 */
  reasoningEffort: number
  search: boolean
  siderCollapsed: boolean
  /** 是否启用工具调用（关闭后退化为纯聊天） */
  agentEnabled: boolean
  /** 危险操作审批：ask 弹窗确认，auto 直接执行（完全访问，无需确认） */
  toolApproval: 'ask' | 'auto'
  /** 单轮对话内最多的工具调用轮次，防止死循环 */
  maxToolRounds: number
  /** 是否启用最大步数限制；关闭后模型可以一直调用工具 */
  maxStepsEnabled: boolean
  /** 采样温度，null 表示不下发、用服务端默认值 */
  temperature: number | null
  /** 核采样 top_p，null 表示不下发、用服务端默认值 */
  topP: number | null
  /** 演示模式：使用本地脚本化模型，便于无 Key 体验工具链路 */
  mockAgent: boolean
  /** 动画特效强度：full 完整，reduced 仅保留必要过渡 */
  motion: 'full' | 'reduced'
  /** 逐项动效开关，叠加在 motion 之上 */
  anim: AnimSettings
  /** 动画时长倍率：0.5 更快，2 更慢 */
  animSpeed: number
  /** 视觉风格：中性克制 / 原极光 */
  look: LookPreference
  /** 液态玻璃强度 */
  glass: GlassPreference
  /** token 统计方式 */
  tokenCounter: TokenCounterMode
  /** 一轮里最多同时执行多少个工具；1 表示顺序执行 */
  parallelTools: number
  /** 长耗时工具自动转入后台任务列表，对话不被阻塞 */
  backgroundTools: boolean
  /** 完整系统提示词；首次打开预填默认文本，用户可直接修改 */
  systemPrompt: string
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  model: 'chat-agent:model',
  thinking: 'chat-demo:thinking',
  reasoningEffort: 'chat-agent:reasoning-effort',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  agentEnabled: 'chat-agent:agent-enabled',
  notifyOnDone: 'chat-agent:notify-on-done',
  toolApproval: 'chat-agent:tool-approval',
  maxToolRounds: 'chat-agent:max-tool-rounds',
  maxStepsEnabled: 'chat-agent:max-steps-enabled',
  temperature: 'chat-agent:temperature',
  topP: 'chat-agent:top-p',
  mockAgent: 'chat-agent:mock-agent',
  motion: 'chat-agent:motion',
  anim: 'chat-agent:anim',
  animSpeed: 'chat-agent:anim-speed',
  look: 'chat-agent:look',
  glass: 'chat-agent:glass',
  tokenCounter: 'chat-agent:token-counter',
  parallelTools: 'chat-agent:parallel-tools',
  backgroundTools: 'chat-agent:background-tools',
  systemPrompt: 'chat-agent:system-prompt',
  systemPromptMigrated: 'chat-agent:system-prompt-v2',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

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

/**
 * 系统提示词的初始值。
 *
 * v0.7 之前只存「追加片段」，v0.8 改成存完整提示词。迁移只做一次：
 * 用 v2 标记区分，之后用户哪怕把身份句删掉，也不会在下次启动时被加回来。
 */
const initialSystemPrompt = (): string => {
  const saved = read(KEYS.systemPrompt)
  if (read(KEYS.systemPromptMigrated) === '1') {
    return saved ?? ''
  }
  const migrated = migrateSystemPrompt(saved)
  write(KEYS.systemPromptMigrated, '1')
  if (migrated !== (saved ?? '')) {
    write(KEYS.systemPrompt, migrated)
  }
  return migrated
}

/** 默认模型，与实际服务的模型 id 一致 */
export const DEFAULT_MODEL = 'deepseek-flash'

/** 1-4 档对应的协议字段值，0 档不下发 */
const REASONING_EFFORT = ['low', 'medium', 'high', 'max'] as const

export const reasoningEffortValue = (effort: number) =>
  REASONING_EFFORT[Math.min(REASONING_EFFORT.length, Math.max(1, effort)) - 1]

/** Anthropic 兼容接口的思考预算，按档位递增 */
const THINKING_BUDGET = [0, 1024, 4096, 12000, 32000] as const

/** 服务端要求思考预算至少 1024，0 档也按下限兜底（正常路径不会用到） */
export const thinkingBudget = (effort: number) =>
  THINKING_BUDGET[Math.min(THINKING_BUDGET.length - 1, Math.max(1, effort))]

/** 思考强度分级：0 关闭，4 极致；标签与消耗提示由界面层翻译 */
export const EFFORT_LEVELS = 4

const initialModel = (): string => {
  const saved = read(KEYS.model)?.trim()
  return saved ? saved : DEFAULT_MODEL
}

const initialEffort = (): number => {
  const raw = Number(read(KEYS.reasoningEffort))
  if (Number.isFinite(raw)) {
    return Math.min(EFFORT_LEVELS, Math.max(0, Math.round(raw)))
  }
  return read(KEYS.thinking) === 'true' ? 2 : 0
}

/** 采样参数：没存过或存的值越界都当作「用默认」，即 null */
const readOptional = (key: string, min: number, max: number): number | null => {
  const raw = read(key)
  if (raw === null || raw.trim() === '') {
    return null
  }
  const value = Number(raw)
  return Number.isFinite(value) && value >= min && value <= max ? value : null
}

export const MIN_TEMPERATURE = 0
export const MAX_TEMPERATURE = 2
export const MIN_TOP_P = 0
export const MAX_TOP_P = 1

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  model: initialModel(),
  thinking: initialEffort() > 0,
  reasoningEffort: initialEffort(),
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  // 默认开启工具能力，首次使用即可体验 agent
  agentEnabled: read(KEYS.agentEnabled) !== 'false',
  notifyOnDone: read(KEYS.notifyOnDone) !== 'false',
  toolApproval: read(KEYS.toolApproval) === 'auto' ? 'auto' : 'ask',
  maxToolRounds: clampRounds(Number(read(KEYS.maxToolRounds) ?? 8)),
  maxStepsEnabled: read(KEYS.maxStepsEnabled) !== 'false',
  temperature: readOptional(KEYS.temperature, MIN_TEMPERATURE, MAX_TEMPERATURE),
  topP: readOptional(KEYS.topP, MIN_TOP_P, MAX_TOP_P),
  mockAgent: read(KEYS.mockAgent) === 'true',
  motion: read(KEYS.motion) === 'reduced' ? 'reduced' : 'full',
  anim: readAnim(),
  animSpeed: readAnimSpeed(),
  // 默认中性克制：极光那套太像「AI 生成的落地页」，需要的用户在设置里切回来
  look: read(KEYS.look) === 'aurora' ? 'aurora' : 'calm',
  // 默认关闭玻璃效果。
  // backdrop-filter 在 ArkWeb 上要每帧重新采样背景，侧栏和输入框这种大面积区域
  // 叠起来很吃 GPU。关掉不影响任何功能，只是少一点通透感；
  // 想要的话设置里还有「毛玻璃」和「液态玻璃」两档。
  glass:
    read(KEYS.glass) === 'liquid'
      ? 'liquid'
      : read(KEYS.glass) === 'frost'
        ? 'frost'
        : 'off',
  // 精确词表 1.5MB，默认走估算，需要时在设置里切换
  tokenCounter: read(KEYS.tokenCounter) === 'exact' ? 'exact' : 'fast',
  parallelTools: clampParallel(Number(read(KEYS.parallelTools) ?? 4)),
  // 默认开启：长任务在后台跑，界面不被占住
  backgroundTools: read(KEYS.backgroundTools) !== 'false',
  systemPrompt: initialSystemPrompt(),
}))

/** 缺字段时按默认补齐，新增开关对老用户默认打开 */
function readAnim(): AnimSettings {
  try {
    const saved = JSON.parse(read(KEYS.anim) ?? 'null') as Partial<AnimSettings> | null
    if (!saved || typeof saved !== 'object') {
      return DEFAULT_ANIM
    }
    return {
      aurora: saved.aurora !== false,
      shimmer: saved.shimmer !== false,
      transitions: saved.transitions !== false,
      pulse: saved.pulse !== false,
    }
  } catch {
    return DEFAULT_ANIM
  }
}

/** 倍率限制在 0.5-2，避免极端值让界面看着卡死或乱闪 */
export function clampAnimSpeed(value: number): number {
  if (!Number.isFinite(value)) {
    return 1
  }
  return Math.min(2, Math.max(0.5, Math.round(value * 10) / 10))
}

function readAnimSpeed(): number {
  const saved = read(KEYS.animSpeed)
  return clampAnimSpeed(saved === null ? 1 : Number(saved))
}

/** 并行度限制在 1-8：再高对本地工具没有收益，反而放大竞态 */
export function clampParallel(value: number): number {
  if (!Number.isFinite(value)) {
    return 4
  }
  return Math.min(8, Math.max(1, Math.round(value)))
}

/** 轮次限制在 1-24，避免异常配置导致死循环或能力不足 */
export function clampRounds(value: number): number {
  if (!Number.isFinite(value)) {
    return 8
  }
  return Math.min(24, Math.max(1, Math.round(value)))
}

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

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
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setModel = (model: string) => {
  const value = model.trim() || DEFAULT_MODEL
  write(KEYS.model, value)
  useSettings.setState({ model: value })
}

/** 打开思考但强度仍为 0 时，落到「标准」档 */
export const setThinking = (thinking: boolean) => {
  const effort = thinking ? useSettings.getState().reasoningEffort || 2 : 0
  write(KEYS.thinking, String(thinking))
  write(KEYS.reasoningEffort, String(effort))
  useSettings.setState({ thinking, reasoningEffort: effort })
}

/** 拖动轨道：0 档即关闭思考，大于 0 自动点亮深度思考 */
export const setReasoningEffort = (value: number) => {
  const effort = Math.min(EFFORT_LEVELS, Math.max(0, Math.round(value)))
  write(KEYS.reasoningEffort, String(effort))
  write(KEYS.thinking, String(effort > 0))
  useSettings.setState({ reasoningEffort: effort, thinking: effort > 0 })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setAgentEnabled = (agentEnabled: boolean) => {
  write(KEYS.agentEnabled, String(agentEnabled))
  useSettings.setState({ agentEnabled })
}

export const setToolApproval = (toolApproval: Settings['toolApproval']) => {
  write(KEYS.toolApproval, toolApproval)
  useSettings.setState({ toolApproval })
}

export const setMaxToolRounds = (rounds: number) => {
  const maxToolRounds = clampRounds(rounds)
  write(KEYS.maxToolRounds, String(maxToolRounds))
  useSettings.setState({ maxToolRounds })
}

export const setMaxStepsEnabled = (maxStepsEnabled: boolean) => {
  write(KEYS.maxStepsEnabled, String(maxStepsEnabled))
  useSettings.setState({ maxStepsEnabled })
}

/** 传 null 表示回到服务端默认值，同时清掉本地记录 */
export const setTemperature = (value: number | null) => {
  const temperature =
    value === null
      ? null
      : Math.min(MAX_TEMPERATURE, Math.max(MIN_TEMPERATURE, Math.round(value * 100) / 100))
  write(KEYS.temperature, temperature === null ? null : String(temperature))
  useSettings.setState({ temperature })
}

export const setTopP = (value: number | null) => {
  const topP =
    value === null ? null : Math.min(MAX_TOP_P, Math.max(MIN_TOP_P, Math.round(value * 100) / 100))
  write(KEYS.topP, topP === null ? null : String(topP))
  useSettings.setState({ topP })
}

export const setMockAgent = (mockAgent: boolean) => {
  write(KEYS.mockAgent, String(mockAgent))
  useSettings.setState({ mockAgent })
}

export const setMotion = (motion: Settings['motion']) => {
  write(KEYS.motion, motion)
  useSettings.setState({ motion })
}

export const setAnim = (anim: AnimSettings) => {
  write(KEYS.anim, JSON.stringify(anim))
  useSettings.setState({ anim })
}

export const toggleAnim = (key: keyof AnimSettings) => {
  const anim = { ...useSettings.getState().anim, [key]: !useSettings.getState().anim[key] }
  setAnim(anim)
}

export const setAnimSpeed = (value: number) => {
  const animSpeed = clampAnimSpeed(value)
  write(KEYS.animSpeed, String(animSpeed))
  useSettings.setState({ animSpeed })
}

export const setTokenCounter = (tokenCounter: TokenCounterMode) => {
  write(KEYS.tokenCounter, tokenCounter)
  useSettings.setState({ tokenCounter })
}

export const setLook = (look: LookPreference) => {
  write(KEYS.look, look)
  useSettings.setState({ look })
}

export const setGlass = (glass: GlassPreference) => {
  write(KEYS.glass, glass)
  useSettings.setState({ glass })
}

export const setParallelTools = (value: number) => {
  const parallelTools = clampParallel(value)
  write(KEYS.parallelTools, String(parallelTools))
  useSettings.setState({ parallelTools })
}

export const setBackgroundTools = (backgroundTools: boolean) => {
  write(KEYS.backgroundTools, String(backgroundTools))
  useSettings.setState({ backgroundTools })
}

export const setSystemPrompt = (systemPrompt: string) => {
  write(KEYS.systemPrompt, systemPrompt)
  useSettings.setState({ systemPrompt })
}

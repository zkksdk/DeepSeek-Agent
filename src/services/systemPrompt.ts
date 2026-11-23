/**
 * 系统提示词：设置页预填、请求组装与子 Agent 共用这一份文本。
 *
 * - BASE：助手身份，DeepSeek 的固定表述；
 * - TOOL_PURPOSE：工具调用协议，要求每次调用都带一句给用户看的 purpose。
 *
 * 设置里保存的是「完整系统提示词」，不再由代码额外拼接 BASE，
 * 这样用户改哪一句都算数，也不会出现同一段话出现两次。
 */

export const BASE_SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

export const TOOL_PURPOSE_PROMPT =
  '每次调用工具都必须填写 purpose：一句不超过 14 个字的短语，说明这次调用要达成什么，会直接显示给用户。不要写工具名，也不要写完整句子。'

/** 默认完整系统提示词：设置页预填这一份，用户可直接改 */
export const defaultSystemPrompt = (): string =>
  `${BASE_SYSTEM_PROMPT}\n\n${TOOL_PURPOSE_PROMPT}`

/** 旧版本只存「追加片段」；迁移时补上身份说明，避免老用户丢失基础设定 */
export const migrateSystemPrompt = (saved: string | null): string => {
  const value = saved?.trim() ?? ''
  if (!value) {
    return defaultSystemPrompt()
  }
  return value.includes(BASE_SYSTEM_PROMPT) ? value : `${BASE_SYSTEM_PROMPT}\n\n${value}`
}

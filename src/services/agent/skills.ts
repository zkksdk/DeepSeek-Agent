/**
 * 自定义技能（HTTP 工具）：用一段 JSON 声明一个 HTTP 接口，模型可像内置工具一样调用。
 * 完全在前端执行，适合对接自有 API、Webhook、第三方开放接口（需允许跨域）。
 */
import type { ClientToolDefinition } from '../api/types.js'
import { storage } from '../platform/storage.js'

export type HttpSkillParam = { name: string; description?: string; required?: boolean }

export type HttpSkill = {
  id: string
  /** 技能名（工具名的一部分） */
  name: string
  description: string
  method: 'GET' | 'POST'
  /** 支持 {param} 占位符 */
  url: string
  headers?: Record<string, string>
  /** POST 请求体模板，支持 {param} 占位符 */
  bodyTemplate?: string
  params: HttpSkillParam[]
  enabled: boolean
}

const SKILLS_KEY = 'chat-demo:http-skills'

export const readHttpSkills = (): HttpSkill[] => {
  const raw = storage.getJSON<unknown>(SKILLS_KEY, [])
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter(
    (item): item is HttpSkill =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as HttpSkill).id === 'string' &&
      typeof (item as HttpSkill).name === 'string' &&
      typeof (item as HttpSkill).url === 'string'
  )
}

export const saveHttpSkills = (skills: HttpSkill[]) => {
  storage.setJSON(SKILLS_KEY, skills)
}

/** 从 JSON 文本解析一个技能定义 */
export const parseHttpSkill = (json: string): { skill?: HttpSkill; error?: string } => {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    return { error: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}` }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { error: '技能定义必须是 JSON 对象' }
  }
  const raw = parsed as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const description = typeof raw.description === 'string' ? raw.description.trim() : ''
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  if (!name || !url) {
    return { error: '缺少必填字段：name、url' }
  }
  if (!/^https?:\/\//i.test(url)) {
    return { error: 'url 必须以 http(s):// 开头' }
  }
  const method = raw.method === 'POST' ? 'POST' : 'GET'
  const paramsRaw = Array.isArray(raw.params) ? raw.params : []
  const params: HttpSkillParam[] = paramsRaw
    .filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null
    )
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name : '',
      description: typeof item.description === 'string' ? item.description : undefined,
      required: item.required === true,
    }))
    .filter((item) => item.name)
  const headers =
    typeof raw.headers === 'object' && raw.headers !== null && !Array.isArray(raw.headers)
      ? Object.fromEntries(
          Object.entries(raw.headers as Record<string, unknown>)
            .filter(([, value]) => typeof value === 'string')
            .map(([key, value]) => [key, value as string])
        )
      : undefined
  const skill: HttpSkill = {
    id: `skill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: name.slice(0, 40),
    description: description || `自定义技能 ${name}`,
    method,
    url,
    headers,
    bodyTemplate: typeof raw.bodyTemplate === 'string' ? raw.bodyTemplate : undefined,
    params,
    enabled: true,
  }
  return { skill }
}

export const addHttpSkill = (skill: HttpSkill) => {
  saveHttpSkills([...readHttpSkills(), skill])
}

export const removeHttpSkill = (id: string) => {
  saveHttpSkills(readHttpSkills().filter((skill) => skill.id !== id))
}

export const setHttpSkillEnabled = (id: string, enabled: boolean) => {
  saveHttpSkills(readHttpSkills().map((skill) => (skill.id === id ? { ...skill, enabled } : skill)))
}

/** 模型侧工具名：skill_<安全化后的技能名>，保证符合命名限制 */
export const skillToolName = (skill: HttpSkill): string =>
  `skill_${skill.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 64)

export const skillToDefinition = (skill: HttpSkill): ClientToolDefinition => ({
  name: skillToolName(skill),
  description: skill.description,
  input_schema: {
    type: 'object',
    properties: Object.fromEntries(
      skill.params.map((param) => [
        param.name,
        { type: 'string', description: param.description ?? param.name },
      ])
    ),
    required: skill.params.filter((param) => param.required).map((param) => param.name),
  },
})

const fillTemplate = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
  )

/** 执行技能：替换占位符后发起 HTTP 请求，返回文本结果 */
export const runHttpSkill = async (
  skill: HttpSkill,
  input: unknown,
  signal?: AbortSignal
): Promise<{ content: string; isError: boolean }> => {
  const values: Record<string, string> = {}
  if (typeof input === 'object' && input !== null) {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      values[key] = typeof value === 'string' ? value : JSON.stringify(value)
    }
  }
  for (const param of skill.params) {
    if (param.required && !values[param.name]) {
      return { content: `缺少必填参数：${param.name}`, isError: true }
    }
  }
  try {
    const url = fillTemplate(skill.url, values)
    const init: RequestInit = {
      method: skill.method,
      headers: { Accept: 'application/json, text/plain', ...skill.headers },
      signal,
    }
    if (skill.method === 'POST' && skill.bodyTemplate) {
      init.body = fillTemplate(skill.bodyTemplate, values)
      const headers = init.headers as Record<string, string>
      if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json'
      }
    }
    const response = await fetch(url, init)
    const text = (await response.text()).slice(0, 4000)
    if (!response.ok) {
      return { content: `HTTP ${response.status}：${text}`, isError: true }
    }
    return { content: text || '（空响应）', isError: false }
  } catch (error) {
    return {
      content: `技能调用失败：${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    }
  }
}

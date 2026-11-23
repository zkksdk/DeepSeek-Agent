import { deflateSync, inflateSync } from 'fflate'
import { createId } from '../../utils/id.js'
import type { AssistantMessage, Session, UserMessage } from './types.js'

/**
 * 把一整段对话压进二维码。
 *
 * 只保留能读的部分：角色 + 正文。工具调用、思考过程、附件原件都不带——
 * 它们要么依赖本机文件，要么体积大到二维码装不下。
 *
 * 编码链路：紧凑 JSON → deflate → base64url。前缀 v1 标记格式，方便以后换编码。
 * QR 单张的上限是 2953 字节（版本 40 / 纠错 L），base64 会膨胀 4/3，
 * 所以压缩后的 JSON 要控制在 1800 字节以内，这里留到 2400 字符的上限。
 */

const VERSION = 'v1'
const MAX_PAYLOAD = 2400
/** 单条消息的正文上限，避免一条长回复吃掉整个二维码 */
const MAX_BODY = 1200

export type ShareResult =
  | { ok: true; payload: string; messages: number; bytes: number }
  | { ok: false; reason: 'empty' | 'too-large'; bytes: number }

type Packed = {
  /** 标题 */
  t?: string
  /** [角色 0=用户 1=助手, 正文] */
  m: [0 | 1, string][]
  /** 创建时间 */
  c?: number
}

const toBase64Url = (bytes: Uint8Array) => {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (value: string) => {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** 只保留正文：思考、工具块、引用都不进二维码 */
const bodyOf = (blocks: AssistantMessage['blocks']) =>
  blocks
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
    .trim()
    .slice(0, MAX_BODY)

export const packSession = (session: Session): Packed => {
  const messages: Packed['m'] = []
  for (const message of session.messages) {
    if (message.role === 'user') {
      const text = message.content.trim().slice(0, MAX_BODY)
      if (text) {
        messages.push([0, text])
      }
      continue
    }
    const text = bodyOf(message.blocks)
    if (text) {
      messages.push([1, text])
    }
  }
  return { t: session.title || undefined, m: messages, c: session.createdAt }
}

export const encodeShare = (session: Session): ShareResult => {
  const packed = packSession(session)
  if (packed.m.length === 0) {
    return { ok: false, reason: 'empty', bytes: 0 }
  }
  const raw = new TextEncoder().encode(JSON.stringify(packed))
  const compressed = deflateSync(raw, { level: 9 })
  const payload = `${VERSION}.${toBase64Url(compressed)}`
  if (payload.length > MAX_PAYLOAD) {
    return { ok: false, reason: 'too-large', bytes: payload.length }
  }
  return { ok: true, payload, messages: packed.m.length, bytes: payload.length }
}

/** 分享链接：保留当前页面路径，只换 hash，静态站与 file:// 下都能用 */
export const shareLink = (payload: string) => {
  const base = window.location.href.split('#')[0]
  return `${base}#/share/${payload}`
}

/** 二维码装不下时的兜底：一份能直接粘贴的纯文本 */
export const toTranscript = (session: Session) => {
  const lines = [`# ${session.title || '对话'}`]
  for (const message of session.messages) {
    const text =
      message.role === 'user'
        ? message.content
        : message.blocks
            .filter((block) => block.type === 'text')
            .map((block) => (block.type === 'text' ? block.text : ''))
            .join('\n')
    if (!text.trim()) {
      continue
    }
    lines.push('', message.role === 'user' ? '**我**' : '**助手**', '', text.trim())
  }
  return lines.join('\n')
}

export type SharePreview = {
  title: string
  messages: { role: 'user' | 'assistant'; text: string }[]
  createdAt: number
}

export const decodeShare = (payload: string): SharePreview | null => {
  const [version, data] = payload.split('.', 2)
  if (version !== VERSION || !data) {
    return null
  }
  try {
    const json = JSON.parse(
      new TextDecoder().decode(inflateSync(fromBase64Url(data)))
    ) as Partial<Packed>
    if (!Array.isArray(json.m)) {
      return null
    }
    const messages = json.m
      .filter((item): item is [0 | 1, string] => Array.isArray(item) && typeof item[1] === 'string')
      .map(([role, text]) => ({ role: role === 0 ? ('user' as const) : ('assistant' as const), text }))
    if (messages.length === 0) {
      return null
    }
    return {
      title: typeof json.t === 'string' && json.t.trim() ? json.t.trim() : '分享的对话',
      messages,
      createdAt: typeof json.c === 'number' ? json.c : Date.now(),
    }
  } catch {
    return null
  }
}

/** 把分享内容还原成一条可继续对话的本地会话 */
export const toSession = (preview: SharePreview): Session => {
  const now = Date.now()
  let stamp = preview.createdAt
  const messages: (UserMessage | AssistantMessage)[] = preview.messages.map((message, index) => {
    stamp += index
    if (message.role === 'user') {
      return {
        id: createId(),
        role: 'user',
        content: message.text,
        files: [],
        createdAt: stamp,
      }
    }
    return {
      id: createId(),
      role: 'assistant',
      createdAt: stamp,
      model: 'deepseek-flash',
      thinking: false,
      search: false,
      prefix: false,
      status: 'done',
      blocks: [{ type: 'text', text: message.text }],
    }
  })
  return {
    id: createId(),
    title: preview.title,
    createdAt: preview.createdAt,
    updatedAt: now,
    messages,
  }
}

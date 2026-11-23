import { createId } from '../../utils/id.js'
import * as db from '../chat/db.js'
import type { ArtifactKind, ArtifactMeta, ToolSource } from './types.js'

/** 扩展名到 MIME 与展示类型的映射；未知类型按二进制处理 */
const TYPES: Record<string, { mime: string; kind: ArtifactKind }> = {
  md: { mime: 'text/markdown', kind: 'markdown' },
  markdown: { mime: 'text/markdown', kind: 'markdown' },
  txt: { mime: 'text/plain', kind: 'text' },
  log: { mime: 'text/plain', kind: 'text' },
  html: { mime: 'text/html', kind: 'html' },
  htm: { mime: 'text/html', kind: 'html' },
  json: { mime: 'application/json', kind: 'json' },
  csv: { mime: 'text/csv', kind: 'csv' },
  tsv: { mime: 'text/tab-separated-values', kind: 'csv' },
  js: { mime: 'text/javascript', kind: 'code' },
  mjs: { mime: 'text/javascript', kind: 'code' },
  ts: { mime: 'text/typescript', kind: 'code' },
  tsx: { mime: 'text/typescript', kind: 'code' },
  jsx: { mime: 'text/javascript', kind: 'code' },
  py: { mime: 'text/x-python', kind: 'code' },
  css: { mime: 'text/css', kind: 'code' },
  svg: { mime: 'image/svg+xml', kind: 'image' },
  png: { mime: 'image/png', kind: 'image' },
  jpg: { mime: 'image/jpeg', kind: 'image' },
  jpeg: { mime: 'image/jpeg', kind: 'image' },
  gif: { mime: 'image/gif', kind: 'image' },
  webp: { mime: 'image/webp', kind: 'image' },
  pdf: { mime: 'application/pdf', kind: 'binary' },
  zip: { mime: 'application/zip', kind: 'binary' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'binary' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'binary' },
}

const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''

export const inferType = (name: string, mime?: string): { mime: string; kind: ArtifactKind } => {
  const known = TYPES[extensionOf(name)]
  if (known) {
    return { mime: mime || known.mime, kind: known.kind }
  }
  if (mime?.startsWith('image/')) {
    return { mime, kind: 'image' }
  }
  if (mime?.startsWith('text/')) {
    return { mime, kind: 'text' }
  }
  return { mime: mime || 'application/octet-stream', kind: 'binary' }
}

const byteLength = (text: string) => new TextEncoder().encode(text).length

export type CreateArtifactInput = {
  name: string
  /** 文本内容；与 dataUrl 二选一 */
  text?: string
  /** base64 data URL，用于图片或二进制 */
  dataUrl?: string
  mime?: string
  /** 覆盖按扩展名推断的类型，widget 需要 */
  kind?: ArtifactKind
  source: ToolSource
  tool?: string
  sessionId?: string
}

/**
 * 创建产物：元数据返回给消息保存，正文写入 IndexedDB。
 * 失败（隐私模式、超额）时仍返回元数据，界面可提示无法下载。
 */
export const createArtifact = async (input: CreateArtifactInput): Promise<ArtifactMeta> => {
  const inferred = inferType(input.name, input.mime)
  const kind = input.kind ?? inferred.kind
  const mime = input.mime ?? inferred.mime
  const id = createId()
  const createdAt = Date.now()
  const size = input.text !== undefined ? byteLength(input.text) : estimateDataUrlSize(input.dataUrl)
  const meta: ArtifactMeta = {
    id,
    name: input.name,
    mime,
    size,
    kind,
    createdAt,
    source: input.source,
    tool: input.tool,
  }
  try {
    await db.saveArtifact({
      ...meta,
      kind,
      source: input.source,
      text: input.text,
      dataUrl: input.dataUrl,
      sessionId: input.sessionId,
    })
  } catch (error) {
    db.reportStorageError('save artifact')(error)
  }
  return meta
}

/** data URL 的 base64 体积换算，去掉头部 */
const estimateDataUrlSize = (dataUrl?: string) => {
  if (!dataUrl) {
    return 0
  }
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return Math.floor((base64.length * 3) / 4)
}

const urlCache = new Map<string, string>()

/** 把文本或 data URL 还原成 Blob URL；同一产物复用同一个地址 */
export const getArtifactUrl = async (id: string): Promise<string | null> => {
  const cached = urlCache.get(id)
  if (cached) {
    return cached
  }
  const stored = await db.loadArtifact(id)
  if (!stored) {
    return null
  }
  const url = stored.text !== undefined ? blobUrlFromText(stored.text, stored.mime) : stored.dataUrl
  if (url) {
    urlCache.set(id, url)
    return url
  }
  return null
}

const blobUrlFromText = (text: string, mime: string) => {
  try {
    return URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }))
  } catch {
    return null
  }
}

export const loadArtifactText = async (id: string): Promise<string | null> => {
  const stored = await db.loadArtifact(id)
  return stored?.text ?? null
}

/** 触发浏览器下载；data URL 直接使用，文本产物按原 MIME 生成 */
export const downloadArtifact = async (meta: ArtifactMeta): Promise<boolean> => {
  const url = await getArtifactUrl(meta.id)
  if (!url) {
    return false
  }
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = meta.name
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  return true
}

export const formatBytes = (size: number) => {
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

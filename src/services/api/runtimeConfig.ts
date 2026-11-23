/**
 * 运行时 API 地址解析：设置中可自定义 API 基础地址（兼容任意 Anthropic 兼容服务/聚合网关），
 * 未设置时回落到构建期注入的默认地址（默认 https://api.deepseek.com）。
 * 单独成文件，避免 client 与 settings 之间产生循环依赖。
 */

import { storage } from '../platform/storage.js'

/** 与 settings.ts 中 apiOrigin 的 localStorage key 保持一致 */
const API_ORIGIN_STORAGE_KEY = 'chat-demo:api-origin'

/** 构建期默认 API 地址 */
export const DEFAULT_API_ORIGIN = __API_ORIGIN__

/** 规范化：去首尾空白与末尾斜杠 */
export const normalizeApiOrigin = (value: string | null | undefined): string => {
  const trimmed = (value ?? '').trim()
  return trimmed ? trimmed.replace(/\/+$/, '') : ''
}

/** 当前生效的 API 基础地址：自定义优先，否则使用默认地址 */
export const getApiOrigin = (): string =>
  normalizeApiOrigin(storage.get(API_ORIGIN_STORAGE_KEY)) || DEFAULT_API_ORIGIN

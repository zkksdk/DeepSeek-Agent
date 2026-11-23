/**
 * 平台能力适配层（敏感凭证）。
 *
 * Web 端只能落在 localStorage（浏览器没有钥匙串），这里如实实现，不假装加密。
 * 打包成原生 App 时，把这三个函数换成系统安全存储即可：
 * - Android/iOS：Capacitor Secure Storage / Keychain
 * - 鸿蒙：@ohos.security.asset（资产存储）
 *
 * 接口设计成异步，便于替换为原生异步 API；Web 实现即时返回。
 */
import { storage } from './storage.js'

const API_KEY_STORAGE = 'chat-demo:api-key'

export const readApiKey = async (): Promise<string | null> => storage.get(API_KEY_STORAGE)

export const persistApiKey = async (value: string | null): Promise<void> => {
  storage.set(API_KEY_STORAGE, value)
}

/** 清空凭证（例如用户主动注销） */
export const clearApiKey = async (): Promise<void> => {
  storage.set(API_KEY_STORAGE, null)
}

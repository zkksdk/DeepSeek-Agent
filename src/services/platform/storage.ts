/**
 * 平台能力适配层（存储）。
 * Web 版用 localStorage；打包成原生 App 时可在此换成系统存储（如 Capacitor Preferences），
 * 业务代码无需改动。
 */

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) {
        localStorage.removeItem(key)
      } else {
        localStorage.setItem(key, value)
      }
    } catch {
      // 存储不可用时只在内存生效
    }
  },
  getJSON<T>(key: string, fallback: T): T {
    try {
      const raw = storage.get(key)
      return raw === null ? fallback : (JSON.parse(raw) as T)
    } catch {
      return fallback
    }
  },
  setJSON(key: string, value: unknown) {
    try {
      storage.set(key, JSON.stringify(value))
    } catch {
      // 忽略不可序列化或超额
    }
  },
}

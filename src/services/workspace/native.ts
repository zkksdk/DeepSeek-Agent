/**
 * 原生能力桥（@pura/harmony-utils）。
 *
 * 这些都是 Web 层拿不到的东西：设备信息、网络状态、系统通知、剪贴板。
 * 壳在页面启动时注入 __DS_SHELL__，注入前一律返回 null，调用方自己兜底。
 *
 * 全部同步方法，失败返回 null 而不是抛异常——跨桥抛出去 Web 侧只能拿到 undefined。
 */

type ShellApi = {
  nativeInfo?: () => string
  nativeNetwork?: () => string
  nativeNotify?: (title: string, text: string) => string
  nativeToast?: (text: string) => string
  nativeClipboard?: (mode: string, text: string) => string
  nativePref?: (mode: string, key: string, value: string) => string
}

const shell = (): ShellApi | null => {
  const api = (globalThis as { __DS_SHELL__?: ShellApi }).__DS_SHELL__
  return api && typeof api === 'object' ? api : null
}

const parse = <T,>(raw: string | undefined): (T & { ok: boolean; error?: string }) | null => {
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as T & { ok: boolean; error?: string }
  } catch {
    return null
  }
}

export type NativeInfo = {
  brand: string
  model: string
  brandModel: string
  marketName: string
  width: number
  height: number
  apiVersion: number
  colorMode: string
}

export type NativeNetwork = {
  available: boolean
  metered: boolean
}

export const canUseNative = () => {
  const api = shell()
  return Boolean(api && typeof api.nativeInfo === 'function')
}

/** 设备 / 屏幕 / 应用信息；取不到返回 null */
export const getNativeInfo = (): NativeInfo | null => {
  const result = parse<NativeInfo>(shell()?.nativeInfo?.())
  if (!result?.ok) {
    return null
  }
  const { ok: _ok, error: _error, ...info } = result
  return info as NativeInfo
}

export const getNativeNetwork = (): NativeNetwork | null => {
  const result = parse<NativeNetwork>(shell()?.nativeNetwork?.())
  if (!result?.ok) {
    return null
  }
  return { available: result.available, metered: result.metered }
}

/** 发系统通知；应用没被授予通知权限时返回 false */
export const sendNativeNotify = (title: string, text: string) => {
  const result = parse<Record<string, never>>(shell()?.nativeNotify?.(title, text))
  return result?.ok === true
}

/** 系统 Toast，比自绘的更贴近系统观感 */
export const showNativeToast = (text: string) => {
  const result = parse<Record<string, never>>(shell()?.nativeToast?.(text))
  return result?.ok === true
}

export const readNativeClipboard = (): string | null => {
  const result = parse<{ text?: string }>(shell()?.nativeClipboard?.('read', ''))
  return result?.ok ? (result.text ?? '') : null
}

export const writeNativeClipboard = (text: string) => {
  const result = parse<Record<string, never>>(shell()?.nativeClipboard?.('write', text))
  return result?.ok === true
}

/** 原生偏好存储：比 localStorage 更抗 WebView 数据清理 */
export const readNativePref = (key: string): string | null => {
  const result = parse<{ value?: string }>(shell()?.nativePref?.('get', key, ''))
  return result?.ok ? (result.value ?? '') : null
}

export const writeNativePref = (key: string, value: string) => {
  const result = parse<Record<string, never>>(shell()?.nativePref?.('set', key, value))
  return result?.ok === true
}

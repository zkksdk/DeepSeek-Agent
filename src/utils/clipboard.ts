import { canUseNative, readNativeClipboard, writeNativeClipboard } from '../services/workspace/native.js'

export const copyText = async (text: string): Promise<boolean> => {
  // 原生剪贴板优先：ArkWeb 里 navigator.clipboard 受权限和 secure context 双重限制，
  // 而系统剪贴板没有这些约束，复制完还能被别的应用粘贴。
  if (canUseNative() && writeNativeClipboard(text)) {
    return true
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 剪贴板权限受限时尝试兼容方式。
  }

  // 兼容手机通过局域网 HTTP 访问的情况。
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px'

  try {
    document.body.appendChild(textarea)
    textarea.focus({ preventScroll: true })
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

/** 读剪贴板：原生优先，回退 Web API；都没有就返回空串 */
export const readText = async (): Promise<string> => {
  if (canUseNative()) {
    const value = readNativeClipboard()
    if (value !== null) {
      return value
    }
  }
  try {
    return (await navigator.clipboard?.readText()) ?? ''
  } catch {
    return ''
  }
}

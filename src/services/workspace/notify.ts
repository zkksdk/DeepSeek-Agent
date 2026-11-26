import { canUseNative, sendNativeNotify } from './native.js'
import { useSettings } from '../settings.js'

/**
 * 任务完成通知。
 *
 * 只在「用户已经切走」时发：盯着屏幕等结果的人不需要再弹一条通知，
 * 那只是噪音。判断依据是页面可见性——后台标签或锁屏后才值得提醒。
 *
 * 长任务才算：几秒钟就回来的对话不值得打扰，阈值取 20 秒。
 */
const MIN_DURATION_MS = 20_000

let startedAt = 0

export const markRunStart = () => {
  startedAt = Date.now()
}

export const notifyRunDone = (preview: string) => {
  const elapsed = startedAt === 0 ? 0 : Date.now() - startedAt
  startedAt = 0

  if (elapsed < MIN_DURATION_MS) {
    return
  }
  if (!canUseNative()) {
    return
  }
  // 页面在前台 = 用户正看着，不打扰
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    return
  }
  if (!useSettings.getState().notifyOnDone) {
    return
  }
  const text = preview.replace(/\s+/g, ' ').trim().slice(0, 80) || '回复已生成'
  sendNativeNotify('回复完成', text)
}

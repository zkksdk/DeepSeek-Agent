import { canUseNative, sendNativeNotify } from './native.js'
import { useSettings } from '../settings.js'

/**
 * 任务状态通知。
 *
 * 三件事共用一条通知（固定 id，系统会原地替换而不是叠加）：
 * 开始 → 「正在执行」；完成 → 「回复完成」；失败 → 「执行中断」。
 *
 * 只在用户已经切走时发。盯着屏幕等结果的人不需要再看通知栏，
 * 那是噪音。判断依据是页面可见性——后台标签或锁屏后才值得提醒。
 */
const NOTIFY_ID = 7107
const MIN_DURATION_MS = 20_000

let startedAt = 0
let notified = false

/** 任务开始：如果人不在前台，先发一条「正在执行」，让外部知道有东西在跑 */
export const markRunStart = () => {
  startedAt = Date.now()
  notified = false
  if (!shouldNotify()) {
    return
  }
  sendNativeNotify('正在执行', '任务已开始，完成后会提醒你', NOTIFY_ID)
  notified = true
}

/** 任务结束：替换掉那条「正在执行」 */
export const notifyRunDone = (preview: string) => {
  const elapsed = startedAt === 0 ? 0 : Date.now() - startedAt
  startedAt = 0

  const wasNotified = notified
  notified = false

  // 已经开始执行的那条必须收尾，否则通知栏会一直挂着「正在执行」
  if (!wasNotified && elapsed < MIN_DURATION_MS) {
    return
  }
  if (!shouldNotify() && !wasNotified) {
    return
  }
  const text = preview.replace(/\s+/g, ' ').trim().slice(0, 80) || '回复已生成'
  sendNativeNotify('回复完成', text, NOTIFY_ID)
}

/** 中断时把「正在执行」改成「已中断」，不留一条骗人的常驻通知 */
export const notifyRunFailed = () => {
  startedAt = 0
  const wasNotified = notified
  notified = false
  if (!wasNotified) {
    return
  }
  sendNativeNotify('执行中断', '任务没有跑完，回到应用查看原因', NOTIFY_ID)
}

const shouldNotify = () => {
  if (!canUseNative()) {
    return false
  }
  // 不能用 document.visibilityState 判断前后台：ArkWeb 里它永远是 'visible'，
  // 哪怕应用已经切到后台。靠它做条件等于永远不发通知。
  // 改成总是发——用户切走时能看到「正在执行」，在前台时多一条通知也不碍事。
  return useSettings.getState().notifyOnDone
}

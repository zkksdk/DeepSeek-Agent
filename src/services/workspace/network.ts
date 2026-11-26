import { useEffect, useState } from 'react'
import { canUseNative, getNativeNetwork } from './native.js'

/**
 * 在线状态。
 *
 * Web 层只有 navigator.onLine，在 ArkWeb 里它反映的是「WebView 认为自己在网」，
 * 断网后要好几秒才变，甚至不变。原生 NetworkUtil 是系统实时状态，所以优先用它。
 *
 * 原生没有推送事件，只能轮询。5 秒一次足够——比这个更快只会耗电，
 * 断网后用户也不会在 1 秒内就需要提示。
 */
const POLL_MS = 5000

export const useOnline = () => {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const read = () => {
      if (canUseNative()) {
        const native = getNativeNetwork()
        if (native) {
          setOnline(native.available)
          return
        }
      }
      setOnline(typeof navigator === 'undefined' ? true : navigator.onLine)
    }

    read()
    const timer = setInterval(read, POLL_MS)
    // 退化路径：原生桥不可用时靠浏览器事件，至少有个兜底
    window.addEventListener('online', read)
    window.addEventListener('offline', read)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', read)
      window.removeEventListener('offline', read)
    }
  }, [])

  return online
}

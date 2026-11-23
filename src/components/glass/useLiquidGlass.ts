import { useCallback, useEffect, useRef } from 'react'
import { useSettings } from '../../services/settings.js'
import { createLiquidGlass, type GlassHandle, type GlassParams } from './liquidGlass.js'

/**
 * 液态玻璃的挂载层。
 *
 * 侧栏、输入框与右侧问题导航用折射玻璃（createLiquidGlass）；
 * 菜单、Toast 这类小浮层默认只做普通毛玻璃，省掉贴图与滤镜链。
 * 设置、Agent 能力、工作区三个大面板不经过这里，保持 Modal 里的普通毛玻璃。
 */

/** 毛玻璃：不生成位移贴图，只写 data-glass 与 backdrop-filter */
export const applyFrost = (el: HTMLElement, tint = 0.11) => {
  el.dataset.glass = 'blur'
  el.style.setProperty('--lg-tint', String(tint))
  el.style.setProperty('backdrop-filter', 'blur(18px) saturate(1.4)')
  el.style.setProperty('-webkit-backdrop-filter', 'blur(18px) saturate(1.4)')
}

const clearGlass = (el: HTMLElement) => {
  el.removeAttribute('data-glass')
  el.style.removeProperty('backdrop-filter')
  el.style.removeProperty('-webkit-backdrop-filter')
  el.style.removeProperty('--lg-tint')
}

const noopHandle = (el: HTMLElement): GlassHandle => ({
  refresh: () => undefined,
  destroy: () => clearGlass(el),
})

export type GlassOptions = Partial<GlassParams> & {
  /** 强制降级为普通毛玻璃：小控件用它，省掉贴图开销 */
  tier?: 'liquid' | 'frost'
}

type Mode = 'liquid' | 'frost' | 'off'

const attach = (el: HTMLElement, mode: Mode, options: GlassOptions = {}): GlassHandle => {
  if (mode === 'off') {
    clearGlass(el)
    return { refresh: () => undefined, destroy: () => clearGlass(el) }
  }
  if (mode === 'frost' || options.tier === 'frost') {
    applyFrost(el, options.tint)
    return noopHandle(el)
  }
  return createLiquidGlass(el, options)
}

type Attachment = { el: HTMLElement; handle: GlassHandle }

/**
 * 把液态玻璃挂到一个元素上：挂载时生成折射贴图，尺寸变化由 ResizeObserver 重建。
 * 只改变背景的渲染方式，不影响元素本身的布局与事件。
 */
export const useLiquidGlass = <T extends HTMLElement>(options?: GlassOptions) => {
  const ref = useRef<T>(null)
  const mode = useSettings((state) => state.glass)
  // 参数只取一次快照，避免每次渲染重建贴图
  const optionsRef = useRef(options)

  useEffect(() => {
    const el = ref.current
    if (!el) {
      return
    }
    const handle = attach(el, mode, optionsRef.current)
    return () => handle.destroy()
  }, [mode])

  return ref
}

/**
 * 回调 ref 版本：给条件渲染的浮层用（菜单、Toast 在关闭时根本不存在，
 * 对象 ref 的 effect 不会重跑）。元素挂上/卸载时自动装配与清理。
 */
export const useGlassAttach = (options?: GlassOptions) => {
  const mode = useSettings((state) => state.glass)
  const current = useRef<Attachment | null>(null)
  const optionsRef = useRef(options)

  const detach = useCallback(() => {
    current.current?.handle.destroy()
    current.current = null
  }, [])

  // 设置变化时重建：off → 拆掉，frost/liquid → 按新档位重挂
  useEffect(() => {
    const el = current.current?.el
    detach()
    if (!el) {
      return
    }
    current.current = { el, handle: attach(el, mode, optionsRef.current) }
  }, [mode, detach])

  useEffect(() => detach, [detach])

  return useCallback(
    (el: HTMLElement | null) => {
      if (current.current?.el === el) {
        return
      }
      detach()
      if (!el) {
        return
      }
      current.current = { el, handle: attach(el, mode, optionsRef.current) }
    },
    [mode, detach]
  )
}

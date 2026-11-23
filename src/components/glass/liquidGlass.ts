/**
 * 液态玻璃：把 shuding/liquid-glass 的折射算法搬成可复用模块。
 *
 * 原理是用 canvas 生成一张位移贴图（中心平坦、边缘一圈强烈弯曲），
 * 交给 SVG feDisplacementMap 作为 backdrop-filter 的滤镜，浏览器据此对真实背景做像素级位移，
 * 所以折射的永远是实时内容，不会糊、不会错位。
 *
 * backdrop-filter: url(#id) 目前只有 Chromium 支持，其他浏览器退化为普通毛玻璃。
 */

export type GlassParams = {
  /** 折射率：位移贴图 scale 的倍率，越大边缘位移越强 */
  ref: number
  /** 折射圈厚度：SDF 阈值的缩放，越大边缘折射带越宽 */
  edge: number
  /** 形状圆角：roundedRectSDF 的内缩半径 */
  rad: number
  /** 玻璃白度：白色 tint 的 alpha，写入 CSS 变量交给样式层使用 */
  tint: number
  /** 背景模糊：滤镜链里 blur 的半径 */
  blur: number
}

/** 折射参数，取自 liquid glass 展示页的调好的那组值 */
export const GLASS_PARAMS: GlassParams = {
  ref: 0.45,
  edge: 0.6,
  rad: 0.6,
  tint: 0.11,
  blur: 1,
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
/** 低于该尺寸的元素不生成贴图（隐藏或尚未布局） */
const MIN_SIZE = 8

let uid = 0

const smoothStep = (a: number, b: number, t: number) => {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)))
  return x * x * (3 - 2 * x)
}

const roundedRectSDF = (x: number, y: number, width: number, height: number, radius: number) => {
  const qx = Math.abs(x) - width + radius
  const qy = Math.abs(y) - height + radius
  return (
    Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
  )
}

const isFirefox = () =>
  typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent)

/** 能否用 SVG 滤镜做折射；不能时由样式层退回毛玻璃 */
export const canRefract = (): boolean => {
  if (typeof document === 'undefined' || typeof CSS === 'undefined' || isFirefox()) {
    return false
  }
  return (
    CSS.supports('backdrop-filter', 'url(#liquid-glass-probe)') ||
    CSS.supports('-webkit-backdrop-filter', 'url(#liquid-glass-probe)')
  )
}

export type GlassHandle = {
  /** 重新生成位移贴图（尺寸或参数变化后调用） */
  refresh: () => void
  destroy: () => void
}

/**
 * 给一个元素装上液态玻璃。
 * 元素自己的背景色由样式层用 --lg-tint 书写，这里只负责滤镜与位移贴图。
 */
export const createLiquidGlass = (
  el: HTMLElement,
  overrides: Partial<GlassParams> = {}
): GlassHandle => {
  const params: GlassParams = { ...GLASS_PARAMS, ...overrides }
  el.style.setProperty('--lg-tint', String(params.tint))

  if (!canRefract()) {
    // 非 Chromium：保留毛玻璃观感，至少不出现没有背景的透明块
    el.dataset.glass = 'blur'
    el.style.setProperty('backdrop-filter', 'blur(18px) saturate(1.4)')
    el.style.setProperty('-webkit-backdrop-filter', 'blur(18px) saturate(1.4)')
    return { refresh: () => undefined, destroy: () => undefined }
  }

  const id = `liquid-glass-${++uid}`
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none'

  const filter = document.createElementNS(SVG_NS, 'filter')
  filter.setAttribute('id', `${id}_filter`)
  filter.setAttribute('filterUnits', 'userSpaceOnUse')
  filter.setAttribute('colorInterpolationFilters', 'sRGB')
  filter.setAttribute('x', '0')
  filter.setAttribute('y', '0')

  const feImage = document.createElementNS(SVG_NS, 'feImage')
  feImage.setAttribute('id', `${id}_map`)
  // result 才是规范和实现都认的引用名，in2 按它取位移贴图
  feImage.setAttribute('result', 'liquid-glass-map')
  feImage.setAttribute('preserveAspectRatio', 'none')

  const feDisplacementMap = document.createElementNS(SVG_NS, 'feDisplacementMap')
  feDisplacementMap.setAttribute('in', 'SourceGraphic')
  feDisplacementMap.setAttribute('in2', 'liquid-glass-map')
  feDisplacementMap.setAttribute('xChannelSelector', 'R')
  feDisplacementMap.setAttribute('yChannelSelector', 'G')

  filter.append(feImage, feDisplacementMap)
  svg.append(filter)
  document.body.append(svg)

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  let width = 0
  let height = 0
  let frame = 0

  /** 生成位移贴图：先算原始位移，归一化后再写进 RGBA */
  const paint = () => {
    const w = Math.max(2, Math.round(el.offsetWidth))
    const h = Math.max(2, Math.round(el.offsetHeight))
    if (w < MIN_SIZE || h < MIN_SIZE) {
      return false
    }
    width = w
    height = h
    canvas.width = w
    canvas.height = h
    filter.setAttribute('width', String(w))
    filter.setAttribute('height', String(h))
    feImage.setAttribute('width', String(w))
    feImage.setAttribute('height', String(h))

    const data = new Uint8ClampedArray(w * h * 4)
    const raw: number[] = []
    let maxScale = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ix = (x + 0.5) / w - 0.5
        const iy = (y + 0.5) / h - 0.5
        const distance = roundedRectSDF(ix, iy, 0.3, 0.2, params.rad)
        const displacement = smoothStep(0.8, 0, distance - 0.15 / params.edge)
        const scaled = smoothStep(0, 1, displacement)
        const dx = (ix * scaled + 0.5) * w - (x + 0.5)
        const dy = (iy * scaled + 0.5) * h - (y + 0.5)
        maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy))
        raw.push(dx, dy)
      }
    }

    // 原版手感：归一化幅度折半，位移太强会有塑料片感
    maxScale *= 0.5
    for (let i = 0, r = 0; i < data.length; i += 4) {
      data[i] = (raw[r++] / maxScale + 0.5) * 255
      data[i + 1] = (raw[r++] / maxScale + 0.5) * 255
      data[i + 2] = 0
      data[i + 3] = 255
    }
    context?.putImageData(new ImageData(data, w, h), 0, 0)
    feImage.setAttributeNS(XLINK_NS, 'href', canvas.toDataURL())
    feDisplacementMap.setAttribute('scale', String(maxScale * params.ref))
    return true
  }

  /** 滤镜链：折射 → 轻微模糊 → 一点对比与饱和度，和展示页保持一致 */
  const apply = () => {
    const value = `url(#${id}_filter) blur(${params.blur}px) contrast(1.2) brightness(1.05) saturate(1.1)`
    el.style.setProperty('backdrop-filter', value)
    el.style.setProperty('-webkit-backdrop-filter', value)
    el.dataset.glass = 'refract'
  }

  const measure = () => {
    frame = 0
    const w = Math.round(el.offsetWidth)
    const h = Math.round(el.offsetHeight)
    if (w === width && h === height) {
      return
    }
    if (paint()) {
      apply()
    }
  }

  const refresh = () => {
    if (frame) {
      return
    }
    frame = requestAnimationFrame(measure)
  }

  if (paint()) {
    apply()
  }

  // 侧边栏随窗口缩放、输入框随内容长高，都靠尺寸变化重建贴图
  const observer = new ResizeObserver(refresh)
  observer.observe(el)

  return {
    refresh,
    destroy: () => {
      observer.disconnect()
      if (frame) {
        cancelAnimationFrame(frame)
      }
      svg.remove()
      canvas.width = 0
      canvas.height = 0
      el.removeAttribute('data-glass')
      el.style.removeProperty('backdrop-filter')
      el.style.removeProperty('-webkit-backdrop-filter')
      el.style.removeProperty('--lg-tint')
    },
  }
}

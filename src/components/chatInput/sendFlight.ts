/**
 * 发送动画：输入框里的内容先被挤扁、扭一下，再缩成一小团飞进对话区。
 *
 * 为什么不用 canvas 或截图：这里要的是「这段文字本身飞走了」的错觉，
 * 所以直接克隆一段同样字体的 DOM，套一层 SVG 位移滤镜做扭曲，
 * 位移强度在头 30% 时间内拉满、之后随缩放一起收掉。
 *
 * 整个动画只用 transform + opacity + 一个 feDisplacementMap 的 scale 属性，
 * 全部在合成线程完成；420ms 后节点自毁，不留在 DOM 里。
 */

const FLIGHT_MS = 420
const WARP_ID = 'send-warp-filter'

type FlightInput = {
  /** 起点：输入框内容区 */
  from: DOMRect
  text: string
  images: string[]
  /** 终点中心：一般是消息列表底部 */
  to: { x: number; y: number }
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeIn = (t: number) => t * t

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.dataset.motion === 'reduced')

/** 位移滤镜只建一次，多次发送复用 */
const ensureWarpFilter = (): SVGFEDisplacementMapElement | null => {
  const existing = document.getElementById(WARP_ID)
  if (existing) {
    return existing.querySelector('feDisplacementMap')
  }
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('id', WARP_ID)
  svg.setAttribute('aria-hidden', 'true')
  svg.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none'
  const filter = document.createElementNS(ns, 'filter')
  filter.setAttribute('id', 'send-warp')
  filter.setAttribute('x', '-20%')
  filter.setAttribute('y', '-20%')
  filter.setAttribute('width', '140%')
  filter.setAttribute('height', '140%')
  const turbulence = document.createElementNS(ns, 'feTurbulence')
  turbulence.setAttribute('type', 'fractalNoise')
  turbulence.setAttribute('baseFrequency', '0.022 0.05')
  turbulence.setAttribute('numOctaves', '2')
  turbulence.setAttribute('seed', '9')
  turbulence.setAttribute('result', 'noise')
  const displacement = document.createElementNS(ns, 'feDisplacementMap')
  displacement.setAttribute('in', 'SourceGraphic')
  displacement.setAttribute('in2', 'noise')
  displacement.setAttribute('scale', '0')
  displacement.setAttribute('xChannelSelector', 'R')
  displacement.setAttribute('yChannelSelector', 'G')
  filter.append(turbulence, displacement)
  svg.append(filter)
  document.body.append(svg)
  return displacement
}

/** 落点涟漪：一小圈扩散，收尾用 */
const pulseAt = (x: number, y: number) => {
  const ring = document.createElement('div')
  ring.style.cssText = [
    'position:fixed',
    `left:${x}px`,
    `top:${y}px`,
    'width:18px',
    'height:18px',
    'margin:-9px 0 0 -9px',
    'border-radius:50%',
    'border:1px solid currentColor',
    'color:var(--dsw-alias-brand-primary)',
    'opacity:0.5',
    'pointer-events:none',
    'z-index:2147483000',
  ].join(';')
  document.body.append(ring)
  ring
    .animate(
      [
        { transform: 'scale(0.4)', opacity: 0.5 },
        { transform: 'scale(5)', opacity: 0 },
      ],
      { duration: 460, easing: 'cubic-bezier(.2,.7,.3,1)' }
    )
    .addEventListener('finish', () => ring.remove())
}

/**
 * 播放发送动画。调用方不需要 await：动画是纯视觉，发送逻辑照常立即执行。
 */
export const playSendFlight = ({ from, text, images, to }: FlightInput) => {
  if (prefersReducedMotion() || (text.trim() === '' && images.length === 0)) {
    return
  }

  const layer = document.createElement('div')
  layer.style.cssText = [
    'position:fixed',
    `left:${from.left}px`,
    `top:${from.top}px`,
    `width:${from.width}px`,
    'z-index:2147483000',
    'pointer-events:none',
    'transform-origin:50% 0',
    'will-change:transform,opacity',
  ].join(';')

  const card = document.createElement('div')
  card.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'gap:6px',
    'width:100%',
    'transform-origin:50% 0',
    'will-change:transform,filter',
    'font:inherit',
  ].join(';')

  if (images.length > 0) {
    const thumbs = document.createElement('div')
    thumbs.style.cssText = 'display:flex;gap:6px'
    for (const url of images.slice(0, 3)) {
      const img = document.createElement('img')
      img.src = url
      img.style.cssText = [
        'width:48px',
        'height:48px',
        'border-radius:10px',
        'object-fit:cover',
        'box-shadow:0 2px 8px rgba(0,0,0,.16)',
      ].join(';')
      thumbs.append(img)
    }
    card.append(thumbs)
  }

  if (text.trim()) {
    const body = document.createElement('div')
    body.textContent = text
    body.style.cssText = [
      'display:-webkit-box',
      '-webkit-line-clamp:4',
      '-webkit-box-orient:vertical',
      'overflow:hidden',
      'font-size:15px',
      'line-height:24px',
      'color:var(--dsw-alias-label-primary)',
      'word-break:break-word',
      'white-space:pre-wrap',
    ].join(';')
    card.append(body)
  }

  layer.append(card)
  document.body.append(layer)

  const warp = ensureWarpFilter()
  const startX = from.left + from.width / 2
  const startY = from.top
  const dx = to.x - startX
  const dy = to.y - startY
  const startedAt = performance.now()
  let frame = 0

  const step = (now: number) => {
    const t = Math.min(1, (now - startedAt) / FLIGHT_MS)
    // 阶段一：挤扁并轻微下压，同时扭曲拉满
    const squeeze = Math.min(1, t / 0.3)
    // 阶段二：飞向对话区并缩成一个点
    const fly = t <= 0.3 ? 0 : (t - 0.3) / 0.7

    const scaleX = 1 + 0.05 * squeeze - 0.78 * easeIn(fly)
    const scaleY = 1 - 0.2 * squeeze - 0.74 * easeIn(fly)
    const travel = easeOut(fly)
    // 稍微往上抬一点再落下，避免一条直线飞过去太机械
    const lift = Math.sin(Math.PI * travel) * -26
    layer.style.transform = `translate3d(${dx * travel}px, ${dy * travel + lift}px, 0)`
    card.style.transform = `scale(${scaleX}, ${scaleY})`
    layer.style.opacity = String(t < 0.72 ? 1 : 1 - (t - 0.72) / 0.28)

    if (warp) {
      // 扭曲在挤压阶段拉满，飞行阶段收掉，最后是干净的一团
      warp.setAttribute('scale', String(14 * squeeze * (1 - fly)))
    }

    if (t < 1) {
      frame = requestAnimationFrame(step)
    } else {
      layer.remove()
      pulseAt(to.x, to.y)
    }
  }
  frame = requestAnimationFrame(step)

  // 兜底：标签页切走时 rAF 会暂停，回来时确保节点不残留
  window.setTimeout(() => {
    if (frame) {
      cancelAnimationFrame(frame)
    }
    layer.remove()
  }, FLIGHT_MS + 400)
}

/** 目标区域：消息列表的底部中心 */
export const messageTarget = (): { x: number; y: number } => {
  const column = document.querySelector<HTMLElement>('[data-message-list]')
  if (column) {
    const rect = column.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: Math.min(rect.bottom - 24, window.innerHeight - 96) }
  }
  // 欢迎页没有列表：往上飞一段，落在输入框上方
  return { x: window.innerWidth / 2, y: window.innerHeight * 0.42 }
}

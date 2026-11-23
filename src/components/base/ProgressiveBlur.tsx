import clsx from 'clsx'
import type { CSSProperties } from 'react'
import styles from './ProgressiveBlur.module.css'

/**
 * 层数越多过渡越细腻，但每层都是一次 backdrop-filter：
 * 滚动时浏览器每帧都要重新采样这些层的背景，层数直接决定滚动是否跟手。
 * 3 层配合渐变蒙版已经看不出台阶，比 4 层再省四分之一采样。
 */
const LAYERS = 3

/**
 * 渐进式模糊：多张叠在一起的模糊层，越靠近边缘的那层半径越大，
 * 每层再用渐变蒙版裁出一条带，合起来就是「越往边缘越模糊」的连续过渡。
 * 纯装饰，不接收指针事件；父级需要 position: relative/absolute。
 */
export const ProgressiveBlur = ({
  direction = 'top',
  blur = 16,
  tint = 0,
  height,
  className,
  style,
}: {
  /** top：上边缘最模糊；bottom：下边缘最模糊 */
  direction?: 'top' | 'bottom'
  /** 边缘处的最大模糊半径 */
  blur?: number
  /** 边缘处再压一层底色，0 为不加（深色主题下能压住背后的亮内容） */
  tint?: number
  height?: number
  className?: string
  style?: CSSProperties
}) => {
  const layers = Array.from({ length: LAYERS }, (_, index) => {
    const strength = index / (LAYERS - 1)
    // 越强的模糊覆盖越窄：最外层几乎整段，最内层只剩边缘一小条
    const depth = 1 - (index / LAYERS) * 0.93
    const fade = (1 / LAYERS) * 1.3
    const mask = `linear-gradient(${direction === 'top' ? 'to bottom' : 'to top'}, #000 0%, #000 ${Math.max(0, (depth - fade) * 100).toFixed(1)}%, transparent ${(depth * 100).toFixed(1)}%)`
    return {
      blur: blur * strength ** 1.7 + 0.4,
      mask,
    }
  })

  return (
    <div
      className={clsx(styles.root, className)}
      data-direction={direction}
      style={{ ...(height === undefined ? {} : { height }), ...style }}
      aria-hidden
    >
      {layers.map((layer, index) => (
        <span
          key={index}
          className={styles.layer}
          style={{
            backdropFilter: `blur(${layer.blur.toFixed(2)}px)`,
            WebkitBackdropFilter: `blur(${layer.blur.toFixed(2)}px)`,
            maskImage: layer.mask,
            WebkitMaskImage: layer.mask,
          }}
        />
      ))}
      {tint > 0 ? (
        <span
          className={styles.tint}
          style={{
            opacity: tint,
            maskImage: `linear-gradient(${direction === 'top' ? 'to bottom' : 'to top'}, #000 0%, #000 34%, transparent 100%)`,
            WebkitMaskImage: `linear-gradient(${direction === 'top' ? 'to bottom' : 'to top'}, #000 0%, #000 34%, transparent 100%)`,
          }}
        />
      ) : null}
    </div>
  )
}

import { useEffect, useRef } from 'react'
import { useSettings } from '../../services/settings.js'
import styles from './Aurora.module.css'

/**
 * 背景视觉层：极光光斑 + 点阵 + 跟随光标的柔光。
 * 纯装饰，pointer-events: none；精简动效时只保留静态渐变。
 */
export const Aurora = () => {
  const motion = useSettings((state) => state.motion)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (motion === 'reduced') {
      return
    }
    const element = ref.current
    if (!element) {
      return
    }
    let frame = 0
    let x = window.innerWidth / 2
    let y = window.innerHeight * 0.3
    const onMove = (event: PointerEvent) => {
      x = event.clientX
      y = event.clientY
      if (frame) {
        return
      }
      frame = requestAnimationFrame(() => {
        frame = 0
        element.style.setProperty('--mx', `${x}px`)
        element.style.setProperty('--my', `${y}px`)
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (frame) {
        cancelAnimationFrame(frame)
      }
    }
  }, [motion])

  return (
    <div ref={ref} className={styles.root} aria-hidden data-motion={motion}>
      <div className={styles.rail} />
      <div className={styles.blobA} />
      <div className={styles.blobB} />
      <div className={styles.blobC} />
      <div className={styles.grid} />
      <div className={styles.cursor} />
      <div className={styles.vignette} />
    </div>
  )
}

import { useSettings } from '../services/settings.js'

/**
 * 把动效设置写到 html 上，让各组件里的 CSS 能统一读到：
 * data-motion 控制整体强度，data-aurora / data-shimmer / data-transitions / data-pulse
 * 逐项关闭某类动画，--ds-anim-scale 缩放所有过渡与关键帧时长。
 */
const sync = () => {
  const { motion, anim, animSpeed } = useSettings.getState()
  const root = document.documentElement
  root.dataset.motion = motion
  root.dataset.aurora = anim.aurora ? 'on' : 'off'
  root.dataset.shimmer = anim.shimmer ? 'on' : 'off'
  root.dataset.transitions = anim.transitions ? 'on' : 'off'
  root.dataset.pulse = anim.pulse ? 'on' : 'off'
  root.style.setProperty('--ds-anim-scale', String(animSpeed))
}

/** 首屏前应用一次，之后随设置变化同步 */
export const setupMotion = () => {
  sync()
  useSettings.subscribe(sync)
}

import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { contextWindowFor, useContextUsage } from '../../services/chat/contextUsage.js'
import { useSettings } from '../../services/settings.js'
import { Tooltip } from '../base/Tooltip.js'
import styles from './ContextRing.module.css'

const SIZE = 30
const STROKE = 2.5
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** 30k / 1.2M 这类紧凑写法，和状态条保持一致 */
const formatTokens = (value: number): string => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (value >= 10_000) {
    return `${Math.round(value / 1000)}k`
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`
  }
  return String(value)
}

/**
 * 上下文占用圆环：把本轮请求的 token 数按模型窗口折算成百分比。
 * 数据来自服务端上报的用量，用圆环而不是数字，放在输入框底部不抢视线。
 */
export const ContextRing = ({
  sessionId,
  streaming = false,
}: {
  sessionId: string | null
  streaming?: boolean
}) => {
  const t = useTranslate()
  const model = useSettings((state) => state.model)
  const tokens = useContextUsage((state) => (sessionId ? (state.byId[sessionId]?.tokens ?? 0) : 0))
  const window = contextWindowFor(model)
  const ratio = window > 0 ? Math.min(1, tokens / window) : 0
  const percent = Math.round(ratio * 100)
  const level = ratio >= 0.85 ? 'full' : ratio >= 0.6 ? 'high' : 'normal'

  return (
    <Tooltip
      content={
        tokens > 0
          ? t('contextUsageTip', {
              used: formatTokens(tokens),
              total: formatTokens(window),
              percent,
            })
          : t('contextUsageEmpty')
      }
    >
      <span
        className={clsx(styles.ring, streaming && styles.active)}
        data-level={level}
        data-empty={tokens === 0 || undefined}
        role="img"
        aria-label={t('contextUsageLabel', { percent })}
      >
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
          <circle
            className={styles.track}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
          />
          <circle
            className={styles.value}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </svg>
        {/* 没有用量时给一个破折号，比 0 更像「还没开始」 */}
        <span className={styles.percent}>{tokens > 0 ? percent : '–'}</span>
      </span>
    </Tooltip>
  )
}

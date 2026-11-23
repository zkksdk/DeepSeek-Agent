import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { modelLabel } from '../../services/api/models.js'
import { readLiveMetrics, useLiveStats } from '../../services/chat/liveStats.js'
import { useDrafts } from '../../services/chat/drafts.js'
import { estimateTokens, loadTokenizer } from '../../services/tokenizer/index.js'
import { useSettings } from '../../services/settings.js'
import styles from './LiveStatsBar.module.css'

const formatTokens = (value: number): string => {
  if (value >= 100000) {
    return `${Math.round(value / 1000)}k`
  }
  if (value >= 10000) {
    return `${(value / 1000).toFixed(1)}k`
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}k`
  }
  return String(value)
}

const formatFirstToken = (ms: number | null): string => {
  if (ms === null) {
    return '—'
  }
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`
}

const formatCache = (rate: number | null): string =>
  rate === null ? '—' : `${(rate * 100).toFixed(1)}%`

const formatSpeed = (tps: number): string => (tps > 0 ? tps.toFixed(1) : '—')

const formatElapsed = (ms: number): string =>
  ms < 10000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`

/** 数值变化时重挂载，触发一次「模糊上跳」动画 */
const Roll = ({ text }: { text: string }) => (
  <span key={text} className={styles.value}>
    {text}
  </span>
)

const Stat = ({ label, value, unit }: { label: string; value: string; unit?: string }) => (
  <span className={styles.stat}>
    <span className={styles.label}>{label}</span>
    <Roll text={value} />
    {unit ? <span className={styles.unit}>{unit}</span> : null}
  </span>
)

/**
 * 输入框底部的实时状态条。
 *
 * 这里刻意只订阅 run 的 active / sessionId / model 三个标量：
 * 之前直接选整个 run 对象，导致每个 token 都触发一次整条重渲染，
 * 数字和动画被高频刷新反而看不清。现在固定 1 秒取一次最新值。
 * 服务端用量到达前用词表估算输出 token，缓存命中率按本轮输入总量计算。
 */
export const LiveStatsBar = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const active = useLiveStats((state) => state.run?.active ?? false)
  const runSession = useLiveStats((state) => state.run?.sessionId ?? null)
  const runModel = useLiveStats((state) => state.run?.model ?? '')
  const selectedModel = useSettings((state) => state.model)
  const tokenCounter = useSettings((state) => state.tokenCounter)
  const draftText = useDrafts((state) => state.drafts.get(sessionId)?.text ?? '')
  const [draftTokens, setDraftTokens] = useState(0)
  const [metrics, setMetrics] = useState<ReturnType<typeof readLiveMetrics> | null>(null)

  // 固定 1 秒取一次快照：只在生成中打表，结束后数字定格
  useEffect(() => {
    const sync = () => {
      const run = useLiveStats.getState().run
      const current = run && (sessionId === null || run.sessionId === sessionId) ? run : null
      setMetrics(current ? readLiveMetrics(current) : null)
    }
    sync()
    if (!active) {
      return
    }
    const timer = window.setInterval(sync, 1000)
    return () => window.clearInterval(timer)
  }, [active, sessionId, runSession])

  // 草稿计数防抖 220ms：输入过程中不抢主线程
  useEffect(() => {
    const text = draftText.trim()
    if (!text) {
      setDraftTokens(0)
      return
    }
    if (tokenCounter === 'fast') {
      setDraftTokens(estimateTokens(text))
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void loadTokenizer().then((tokenizer) => {
        if (!cancelled) {
          setDraftTokens(tokenizer ? tokenizer.count(text) : estimateTokens(text))
        }
      })
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [draftText, tokenCounter])

  const model = (runSession === sessionId || sessionId === null) && runModel ? runModel : selectedModel
  // 轮次与 metrics 同一个刷新节奏，直接读一次快照
  const rounds = useLiveStats.getState().run?.rounds ?? 0

  return (
    <div className={styles.bar} data-active={active || undefined}>
      <span className={styles.status}>
        <span className={styles.dot} aria-hidden="true" />
        {active ? t('liveRunning') : t('liveReady')}
      </span>
      <span className={styles.model} title={model}>
        {modelLabel(model)}
      </span>
      <span className={styles.sep} aria-hidden="true" />
      {metrics ? (
        <>
          <Stat label={t('liveInput')} value={formatTokens(metrics.inputTokens)} unit="tok" />
          <Stat label={t('liveOutput')} value={formatTokens(metrics.outputTokens)} unit="tok" />
          <Stat label={t('liveFirstToken')} value={formatFirstToken(metrics.firstTokenMs)} />
          <Stat label={t('liveCache')} value={formatCache(metrics.cacheRate)} />
          <Stat label={t('liveSpeed')} value={formatSpeed(metrics.tps)} unit="tok/s" />
          <Stat label={t('liveElapsed')} value={formatElapsed(metrics.elapsed)} />
          {rounds > 1 ? (
            <span className={clsx(styles.stat, styles.rounds)}>
              <span className={styles.label}>×{rounds}</span>
            </span>
          ) : null}
        </>
      ) : (
        <span className={styles.empty}>{t('liveWaiting')}</span>
      )}
      {draftTokens > 0 ? (
        <Stat label={t('liveDraft')} value={formatTokens(draftTokens)} unit="tok" />
      ) : null}
      <span className={styles.sweep} aria-hidden="true" />
    </div>
  )
}

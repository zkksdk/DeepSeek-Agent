import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import {
  currentRates,
  formatDuration,
  formatMoney,
  formatTokens,
  isPeak,
  nextRateChange,
  normalizePricingModel,
  PRICING_URL,
  rateLabel,
} from '../../services/pricing.js'
import { todayUsage, useUsage } from '../../services/usage.js'
import { openSettings } from '../settings/settingsDialogState.js'
import styles from './UsageCard.module.css'

const IconUser = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <circle cx="8" cy="5.4" r="2.6" />
    <path d="M3.2 13.2c.7-2.4 2.5-3.6 4.8-3.6s4.1 1.2 4.8 3.6" />
  </svg>
)

/**
 * 侧栏底部的用量卡片。
 *
 * 参考 DeepSeek 控制台的额度/预算样式：一条预算进度、今日花费占比、
 * 当前是高峰还是空闲（附下一次切换倒计时），底部是登录状态。
 * 金额来自本地账本 + 官方价估算，不做任何网络请求。
 */
export const UsageCard = () => {
  const t = useTranslate()
  const budget = useUsage((state) => state.budget)
  const totalCost = useUsage((state) => state.totalCost)
  const day = useUsage((state) => todayUsage(state))
  const apiKey = useSettings((state) => state.apiKey)
  const model = useSettings((state) => state.model)
  // 倒计时每 30 秒刷新一次即可，不必跟秒
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const percent = budget > 0 ? Math.min(100, (totalCost / budget) * 100) : 0
  const todayPercent = budget > 0 ? (day.cost / budget) * 100 : 0
  const tokens = day.hit + day.miss + day.output
  const modelCount = Object.keys(day.models).length
  const peak = isPeak(now)
  const change = nextRateChange(now)
  const rates = currentRates(normalizePricingModel(model), now)
  const labelKey = peak
    ? 'usageRatePeak'
    : rateLabel(now) === '周末时段'
      ? 'usageRateWeekend'
      : rateLabel(now) === '节假日'
        ? 'usageRateHoliday'
        : 'usageRateOff'
  const changeText =
    change.label === '进入高峰' ? t('usageEnterPeak', { time: formatDuration(change.at - now.getTime()) }) : t('usageBackOff', { time: formatDuration(change.at - now.getTime()) })

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.title}>{t('usageBudget')}</span>
          <b className={styles.percent} data-warn={percent >= 90 || undefined}>
            {percent.toFixed(1)}%
          </b>
        </div>
        <div className={styles.track} role="img" aria-label={`${t('usageBudget')} ${percent.toFixed(1)}%`}>
          <span className={styles.fill} style={{ width: `${percent}%` }} data-warn={percent >= 90 || undefined} />
        </div>
        <div className={styles.meta}>
          <span>
            {t('usageToday')} ¥{formatMoney(day.cost)} · {t('usageOfBudget', { pct: todayPercent.toFixed(1) })}
          </span>
          <span>
            {t('usageUsed')} ¥{formatMoney(totalCost)} / ¥{formatMoney(budget)}
          </span>
        </div>
      </div>

      <div className={styles.rate} data-peak={peak || undefined}>
        <span className={styles.dot} />
        <span className={styles.rateText}>
          {t(labelKey)} · {changeText}
        </span>
      </div>

      <div className={styles.today}>
        <span>
          {t('usageToday')} {formatTokens(tokens)} tokens
        </span>
        <span>{modelCount > 0 ? `${modelCount} ${t('usageModels')}` : t('usageNoData')}</span>
      </div>

      <a
        className={styles.pricing}
        href={PRICING_URL}
        target="_blank"
        rel="noopener noreferrer"
        title={`${rates.text}\n${t('usageHint')}`}
      >
        {t('usagePricing')}
      </a>

      <button type="button" className={styles.login} onClick={() => openSettings('account')}>
        <span className={styles.loginIcon}>
          <IconUser />
        </span>
        <span className={styles.loginText}>{apiKey ? t('usageLoggedIn') : t('usageLogin')}</span>
        <span className={styles.loginDot} data-ready={apiKey ? true : undefined} />
      </button>
    </div>
  )
}

import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { PRICING_URL } from '../../services/pricing.js'
import { resetUsage, setBudget, useUsage } from '../../services/usage.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import { SettingCell } from './SettingCell.js'
import styles from './Settings.module.css'

/**
 * 用量与余额警戒线。
 *
 * 警戒线不是预算：预算管的是"这个月最多花多少"，警戒线管的是"账户剩到这个数就提醒我"。
 * 侧栏的余额数字低于它时标红，好让人早点去充值，别跑到一半没钱。
 * 用量统计（今日花费、累计估算）是纯本地的，按官方价算，跟余额不是一回事。
 */
export const UsageSetting = () => {
  const t = useTranslate()
  const alert = useUsage((state) => state.budget)
  const totalCost = useUsage((state) => state.totalCost)
  // 输入过程中不急着写存储，失焦或回车再提交
  const [draft, setDraft] = useState(String(alert))
  useEffect(() => setDraft(String(alert)), [alert])

  const commit = () => {
    const value = Number(draft)
    if (!Number.isFinite(value) || value <= 0) {
      setDraft(String(alert))
      return
    }
    setBudget(value)
  }

  return (
    <>
      <SettingCell
        label={t('settingsBalanceAlert')}
        description={t('settingsBalanceAlertHint')}
        status={null}
        action={
          <label className={clsx(styles.stepper, styles.budgetStepper)}>
            <span>¥</span>
            <input
              type="number"
              min={1}
              step={10}
              value={draft}
              aria-label={t('settingsBalanceAlert')}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
              }}
            />
          </label>
        }
      />
      <SettingCell
        label={t('settingsUsageReset')}
        description={`${t('settingsUsageResetHint')} · ${t('usageSpentTotal')} ¥${totalCost.toFixed(2)}`}
        status={null}
        action={
          <Button
            variant="outlined"
            size="s"
            className={styles.cellButton}
            onClick={() => {
              resetUsage()
              showToast({ key: 'settingsUsageResetDone' })
            }}
          >
            {t('settingsUsageReset')}
          </Button>
        }
      />
      <SettingCell
        label={t('settingsUsagePricing')}
        description={t('settingsUsagePricingHint')}
        status={null}
        action={
          <a
            className={styles.pricingLink}
            href={PRICING_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('settingsUsageOpenPricing')}
          </a>
        }
      />
    </>
  )
}

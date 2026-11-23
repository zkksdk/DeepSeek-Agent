import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { PRICING_URL } from '../../services/pricing.js'
import { resetUsage, setBudget, useUsage } from '../../services/usage.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import { SettingCell } from './SettingCell.js'
import styles from './Settings.module.css'

/** 用量与预算：预算可改，用量记录可清空；价格只做展示与跳转 */
export const UsageSetting = () => {
  const t = useTranslate()
  const budget = useUsage((state) => state.budget)
  const totalCost = useUsage((state) => state.totalCost)
  // 输入过程中不急着写存储，失焦或回车再提交
  const [draft, setDraft] = useState(String(budget))
  useEffect(() => setDraft(String(budget)), [budget])

  const commit = () => {
    const value = Number(draft)
    if (!Number.isFinite(value) || value <= 0) {
      setDraft(String(budget))
      return
    }
    setBudget(value)
  }

  return (
    <>
      <SettingCell
        label={t('settingsUsageBudget')}
        description={`${t('settingsUsageBudgetHint')} · ${t('usageUsed')} ¥${totalCost.toFixed(2)}`}
        status={null}
        action={
          <label className={clsx(styles.stepper, styles.budgetStepper)}>
            <span>¥</span>
            <input
              type="number"
              min={1}
              step={10}
              value={draft}
              aria-label={t('settingsUsageBudget')}
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
        description={t('settingsUsageResetHint')}
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

import { useEffect, useState } from 'react'
import { useSettings } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { SettingCell } from './SettingCell.js'
import styles from './Settings.module.css'

type BalanceInfo = { currency: string; total_balance: string; granted_balance: string; topped_up_balance: string }
type BalanceBody = { is_available: boolean; balance_infos: BalanceInfo[] }

type ModelInfo = { id: string; name?: string; owned_by?: string; context_window?: number }
type ModelsBody = { data: ModelInfo[] }

/**
 * 账号与余额。
 *
 * 这里的「账号」有两层含义，界面上要分开说：登录指的是 DeepSeek 账号（换来的 token
 * 和 API Key 走同一个字段），余额指的是这个凭据在平台上的钱。两者都不在本机，所以
 * 显示的都是上一次查询的结果，带刷新按钮而不是假装实时。
 */
export const AccountSetting = () => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKey)

  const [balance, setBalance] = useState<BalanceInfo | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    if (!apiKey) {
      return
    }
    setBusy(true)
    setError('')
    try {
      const auth = { Authorization: `Bearer ${apiKey}` }
      const [b, m] = await Promise.all([
        fetch('https://api.deepseek.com/user/balance', { headers: auth }),
        fetch('https://api.deepseek.com/models', { headers: auth }),
      ])
      if (b.ok) {
        const body = (await b.json()) as BalanceBody
        setBalance(body.balance_infos?.[0] ?? null)
      }
      if (m.ok) {
        const body = (await m.json()) as ModelsBody
        setModels(body.data ?? [])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Key 变了就重新查一次
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey])

  return (
    <>
      <SettingCell
        label={t('accountBalance')}
        description={error || undefined}
        status={null}
        action={
          <div className={styles.accountBalanceRow}>
            <span className={styles.accountBalanceValue}>
              {balance ? `${balance.currency === 'CNY' ? '¥' : balance.currency} ${balance.total_balance}` : '—'}
            </span>
            <Button variant="outlined" size="m" disabled={!apiKey || busy} onClick={() => void load()}>
              {busy ? t('accountLoading') : t('accountRefresh')}
            </Button>
          </div>
        }
      />

      <SettingCell
        label={t('accountModels')}
        description={models.length > 0 ? models.map((m) => m.name ?? m.id).join('、') : t('accountModelsEmpty')}
        status={null}
        action={null}
      />
    </>
  )
}

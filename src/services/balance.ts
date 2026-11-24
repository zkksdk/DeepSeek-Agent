import { useEffect } from 'react'
import { create } from 'zustand'
import { useSettings } from './settings.js'

/** 平台返回的余额条目 */
export type BalanceInfo = {
  currency: string
  total_balance: string
  granted_balance: string
  topped_up_balance: string
}

type BalanceState = {
  balance: BalanceInfo | null
  /** 上次成功拉取的时间戳 */
  updatedAt: number
  loading: boolean
  error: string
  refresh: () => Promise<void>
}

const BALANCE_URL = 'https://api.deepseek.com/user/balance'

/**
 * 账号余额。
 *
 * 侧栏卡片和设置页共用这一份，避免两边各查一次。
 * 余额是平台上的真钱，本地算不出来，只能问接口；
 * 拉取失败时保留上一次的数值，不要把界面清空。
 */
export const useBalance = create<BalanceState>((set, get) => ({
  balance: null,
  updatedAt: 0,
  loading: false,
  error: '',
  refresh: async () => {
    const apiKey = useSettings.getState().apiKey
    if (!apiKey) {
      set({ balance: null, error: '' })
      return
    }
    if (get().loading) {
      return
    }
    set({ loading: true, error: '' })
    try {
      const response = await fetch(BALANCE_URL, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const body = (await response.json()) as {
        is_available?: boolean
        balance_infos?: BalanceInfo[]
      }
      const first = body.balance_infos?.[0] ?? null
      set({ balance: first, updatedAt: Date.now(), loading: false })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },
}))

/** 挂上去就自动同步：进页面拉一次，之后每 60 秒刷一次 */
export const useBalanceSync = (intervalMs = 60_000) => {
  const apiKey = useSettings((state) => state.apiKey)
  const refresh = useBalance((state) => state.refresh)

  useEffect(() => {
    if (!apiKey) {
      return
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), intervalMs)
    return () => window.clearInterval(timer)
  }, [apiKey, intervalMs, refresh])
}

/** 余额数值；接口给的是字符串，没有就返回 null */
export const balanceAmount = (info: BalanceInfo | null): number | null => {
  if (!info) {
    return null
  }
  const value = Number(info.total_balance)
  return Number.isFinite(value) ? value : null
}

/** 币种符号 */
export const currencySymbol = (info: BalanceInfo | null): string => {
  if (!info) {
    return '¥'
  }
  return info.currency === 'CNY' ? '¥' : info.currency
}

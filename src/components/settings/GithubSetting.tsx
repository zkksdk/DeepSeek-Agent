import { useEffect, useState } from 'react'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { SettingCell } from './SettingCell.js'
import styles from './Settings.module.css'

export const REPO_URL = 'https://github.com/Aoan2011/DeepSeek-Agent'

/** 星数缓存一小时：GitHub API 匿名限额 60 次/小时，不能每次打开设置都打一次 */
const CACHE_KEY = 'chat-agent:github-stars'
const CACHE_TTL = 60 * 60 * 1000

type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

const GithubIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
)

const readCachedStars = (): number | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) {
      return null
    }
    const saved = JSON.parse(raw) as { stars?: unknown; at?: unknown }
    if (typeof saved.stars !== 'number' || typeof saved.at !== 'number') {
      return null
    }
    if (Date.now() - saved.at > CACHE_TTL) {
      return null
    }
    return saved.stars
  } catch {
    return null
  }
}

/** GitHub 仓库信息：星数来自公开 API，拿不到时只显示入口链接 */
export const GithubSetting = () => {
  const t = useTranslate()
  const [stars, setStars] = useState<number | null>(readCachedStars)

  useEffect(() => {
    if (stars !== null) {
      return
    }
    let cancelled = false
    void fetch('https://api.github.com/repos/Aoan2011/DeepSeek-Agent')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { stargazers_count?: unknown } | null) => {
        const count =
          typeof data?.stargazers_count === 'number' ? data.stargazers_count : null
        if (cancelled || count === null) {
          return
        }
        setStars(count)
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ stars: count, at: Date.now() }))
        } catch {
          // 忽略存储失败
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [stars])

  const status: Status =
    stars !== null
      ? { key: 'settingsGithubStars', params: { count: String(stars) } }
      : null

  return (
    <SettingCell
      label={t('settingsGithub')}
      description={t('settingsGithubHint')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          onClick={() => window.open(REPO_URL, '_blank', 'noopener,noreferrer')}
        >
          <GithubIcon />
          {t('settingsGithubOpen')}
        </Button>
      }
    />
  )
}

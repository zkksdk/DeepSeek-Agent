import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import styles from './BrowserChip.module.css'

type ShellBrowser = {
  openBrowser?: () => Promise<void>
}

/**
 * 内嵌浏览器收起后的入口。
 *
 * 之前试过在壳里画这个胶囊，但输入框是网页渲染的、胶囊是原生浮层，
 * 两套坐标系对不上，怎么写死坐标都会在别的屏幕上错位。放到这里来，
 * 它跟输入框同一个坐标系，天然自适应。
 */
export const BrowserChip = () => {
  const t = useTranslate()
  const [hidden, setHidden] = useState(true)
  const [url, setUrl] = useState('')

  useEffect(() => {
    // 壳把浏览器的显隐状态推进来：展开时这里让位，收起时这里出现
    const handler = (visible: boolean, nextUrl: string) => {
      setHidden(visible)
      setUrl(nextUrl || '')
    }
    ;(window as unknown as { __DS_BROWSER_STATE__?: typeof handler }).__DS_BROWSER_STATE__ =
      handler
    return () => {
      delete (window as unknown as { __DS_BROWSER_STATE__?: typeof handler })
        .__DS_BROWSER_STATE__
    }
  }, [])

  if (hidden || !url) {
    return null
  }

  const open = () => {
    const shell = (window as unknown as { __DS_SHELL__?: ShellBrowser }).__DS_SHELL__
    void shell?.openBrowser?.()
    setHidden(true)
  }

  return (
    <button type="button" className={styles.chip} onClick={open} title={t('browserChipOpen')}>
      <span className={styles.icon}>🌐</span>
      <span className={styles.url}>{url}</span>
      <span className={styles.action}>{t('browserChipExpand')}</span>
    </button>
  )
}

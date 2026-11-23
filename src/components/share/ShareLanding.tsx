import { useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { decodeShare, toSession } from '../../services/chat/share.js'
import { importSharedSession } from '../../services/chat/store.js'
import { Button } from '../base/Button.js'
import { navigate } from '../../app/router.js'
import styles from './ShareLanding.module.css'

/**
 * #/share/<payload> 的落地页。
 *
 * 不在进页面时直接导入：同一个链接被打开两次会凭空多出一份记录，
 * 而且用户还不知道要进来的是什么。给一张预览卡，点一下才建会话。
 */
export const ShareLanding = ({ payload }: { payload: string }) => {
  const t = useTranslate()
  const preview = useMemo(() => decodeShare(payload), [payload])
  const [importing, setImporting] = useState(false)

  if (!preview) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <span className={styles.badge}>{t('shareTitle')}</span>
          <h1 className={styles.title}>{t('shareInvalid')}</h1>
          <Button variant="outlined" size="m" onClick={() => navigate({ kind: 'new' })}>
            {t('shareBack')}
          </Button>
        </div>
      </div>
    )
  }

  const head = preview.messages.slice(0, 4)
  const rest = Math.max(0, preview.messages.length - head.length)

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <span className={styles.badge}>{t('shareImportTitle')}</span>
        <h1 className={styles.title} title={preview.title}>
          {preview.title}
        </h1>
        <p className={styles.hint}>{t('shareImportHint')}</p>
        <div className={styles.preview}>
          {head.map((message, index) => (
            <div key={index} className={styles.row} data-role={message.role}>
              <span className={styles.role}>
                {message.role === 'user' ? t('shareRoleUser') : t('shareRoleAssistant')}
              </span>
              <span className={styles.text}>{message.text}</span>
            </div>
          ))}
          {rest > 0 ? <span className={styles.more}>{t('sharePreviewMore', { count: rest })}</span> : null}
        </div>
        <div className={styles.actions}>
          <Button
            variant="primary"
            size="m"
            disabled={importing}
            onClick={() => {
              setImporting(true)
              void importSharedSession(toSession(preview)).finally(() => setImporting(false))
            }}
          >
            {t('shareImportButton')}
          </Button>
          <Button variant="outlined" size="m" onClick={() => navigate({ kind: 'new' })}>
            {t('shareBack')}
          </Button>
        </div>
      </div>
    </div>
  )
}

import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { IconToastError16 } from './icons.js'
import { useToast } from './toastState.js'
import { useGlassAttach } from '../glass/useLiquidGlass.js'
import styles from './Toast.module.css'

export const Toast = () => {
  const t = useTranslate()
  const { id, message } = useToast()
  const glassRef = useGlassAttach({ tier: 'frost', tint: 0.2 })
  if (!message) {
    return null
  }
  if (typeof message === 'string') {
    return (
      <div key={id} ref={glassRef} className={styles.toast} role="status">
        {message}
      </div>
    )
  }
  const error = message.type === 'error'
  return (
    <div key={id} ref={glassRef} className={clsx(styles.toast, error && styles.error)} role="status">
      {error ? (
        <span className={styles.icon}>
          <IconToastError16 />
        </span>
      ) : null}
      <span className={styles.content}>
        {t(message.key, message.params)}
        {message.link ? (
          <a className={styles.link} href={message.link.href} target="_blank" rel="noopener noreferrer">
            {t(message.link.key)}
          </a>
        ) : null}
      </span>
    </div>
  )
}

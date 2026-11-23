import clsx from 'clsx'
import { useEffect, useRef } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { resolveApproval, useApprovals } from '../../services/agent/approval.js'
import { sourceLabel } from '../../services/agent/types.js'
import { IconWarningOutline16 } from '../base/icons.js'
import { toolIcon } from './ToolIcons.js'
import styles from './ApprovalPanel.module.css'

/** 长文本（如文件内容）只展示摘要，避免确认面板被一整篇文章撑满 */
const shorten = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return value.length > 150 ? `${value.slice(0, 150)}… （共 ${value.length} 字符）` : value
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(shorten)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shorten(item)]))
  }
  return value
}

const formatInput = (input: unknown) => {
  try {
    const record = input as Record<string, unknown> | null
    const cleaned =
      record && typeof record === 'object' && !Array.isArray(record)
        ? Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'purpose'))
        : record
    return JSON.stringify(shorten(cleaned), null, 2)
  } catch {
    return String(input)
  }
}

/** 页面不可见时用系统通知提醒，权限没给的时候退回标题红点 */
const notify = (title: string, body: string) => {
  if (typeof Notification === 'undefined') {
    return
  }
  const show = () => {
    if (Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'agent-approval' })
    }
  }
  if (Notification.permission === 'default') {
    void Notification.requestPermission().then(show)
    return
  }
  show()
}

/** 标题上挂一个待确认标记，页面在后台也能被注意到 */
const useTitleBadge = (active: boolean) => {
  useEffect(() => {
    if (!active) {
      return
    }
    const original = document.title
    document.title = `● ${original}`
    return () => {
      document.title = original
    }
  }, [active])
}

/**
 * 危险操作的确认面板：位置和反问面板一致，挂在输入框上方，
 * 鼠标不用跑去屏幕中间点弹窗，也不会遮住正在生成的内容。
 */
export const ApprovalPanel = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const queue = useApprovals((state) => state.queue)
  // 优先展示当前会话的请求；其他会话的请求在没有当前会话时也照常提示
  const request =
    queue.find((item) => item.sessionId === sessionId) ?? (sessionId === null ? queue[0] : undefined)
  const notified = useRef<string | null>(null)
  useTitleBadge(Boolean(request))

  useEffect(() => {
    if (!request || notified.current === request.id) {
      return
    }
    notified.current = request.id
    if (document.visibilityState === 'hidden') {
      notify(
        t('approvalNotifyTitle'),
        t('approvalNotifyBody', { tool: request.label })
      )
    }
  }, [request, t])

  useEffect(() => {
    if (!request) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') {
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        resolveApproval(request.id, 'deny')
      }
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault()
        resolveApproval(request.id, 'allow_once')
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [request])

  if (!request) {
    return null
  }

  const riskText =
    request.risk === 'exec'
      ? t('agentApprovalRiskExec')
      : request.risk === 'write'
        ? t('agentApprovalRiskWrite')
        : t('agentApprovalRiskNetwork')

  return (
    <div className={styles.card} role="alertdialog" aria-label={t('agentApprovalTitle')}>
      <span className={styles.sweep} aria-hidden />
      <div className={styles.head}>
        <span className={styles.icon}>{toolIcon(request.toolName, request.source)}</span>
        <span className={styles.title}>{t('agentApprovalTitle')}</span>
        <span className={styles.label}>{request.label}</span>
        <span className={styles.source}>{sourceLabel(request.source)}</span>
        <span className={clsx(styles.risk, styles[request.risk])}>
          <IconWarningOutline16 />
          {riskText}
        </span>
        {queue.length > 1 ? (
          <span className={styles.count}>
            +{queue.length - 1} {t('agentApprovalPending')}
          </span>
        ) : null}
      </div>

      <p className={styles.desc}>{request.description}</p>
      <pre className={styles.args}>{formatInput(request.input)}</pre>
      <p className={styles.notice}>{t('agentApprovalNotice')}</p>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.deny}
          onClick={() => resolveApproval(request.id, 'deny')}
        >
          {t('agentApprovalDeny')}
        </button>
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.ghost}
          onClick={() => resolveApproval(request.id, 'allow_session')}
        >
          {t('agentApprovalAllowSession')}
        </button>
        <button
          type="button"
          className={styles.allow}
          onClick={() => resolveApproval(request.id, 'allow_once')}
        >
          {t('agentApprovalAllow')}
        </button>
      </div>
    </div>
  )
}

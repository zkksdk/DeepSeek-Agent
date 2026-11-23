import { useEffect, useMemo, useRef } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { encodeShare, shareLink, toTranscript } from '../../services/chat/share.js'
import { loadSessionDetail, useChatStore } from '../../services/chat/store.js'
import { copyText } from '../../utils/clipboard.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { buildQr, drawQrToCanvas } from './qrCode.js'
import { closeShare, useShareDialog } from './shareDialogState.js'
import styles from './ShareDialog.module.css'

/**
 * 分享对话：把整段对话压成一张二维码。
 *
 * 只带角色与正文（工具调用、思考、附件原件都不带），deflate 之后 base64url 编码。
 * 装不下时不假装成功：直接说明超长，并给一份可粘贴的纯文本兜底。
 */
export const ShareDialog = () => {
  const t = useTranslate()
  const sessionId = useShareDialog((state) => state.sessionId)
  const session = useChatStore((state) =>
    sessionId === null ? undefined : state.sessionCache[sessionId]
  )
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // 从侧栏直接分享一个没打开过的会话时，先把详情读出来
  useEffect(() => {
    if (sessionId !== null && !session) {
      void loadSessionDetail(sessionId)
    }
  }, [sessionId, session])

  const share = useMemo(() => (session ? encodeShare(session) : null), [session])
  const graphic = useMemo(
    () => (share?.ok ? buildQr(shareLink(share.payload)) : null),
    [share]
  )

  useEffect(() => {
    if (!graphic || !canvasRef.current) {
      return
    }
    drawQrToCanvas(canvasRef.current, graphic, { size: 1024 })
  }, [graphic])

  if (sessionId === null) {
    return null
  }

  const copyLink = async () => {
    if (!share?.ok) {
      return
    }
    const ok = await copyText(shareLink(share.payload))
    showToast(ok ? t('shareLinkCopied') : t('copyFailed'))
  }

  const copyTextFallback = async () => {
    if (!session) {
      return
    }
    const ok = await copyText(toTranscript(session))
    showToast(ok ? t('copied') : t('copyFailed'))
  }

  const saveImage = () => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const link = document.createElement('a')
    link.download = `${session?.title || 'conversation'}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <Modal title={t('shareTitle')} closable onClose={closeShare}>
      {!session ? (
        <p className={styles.hint}>{t('shareLoading')}</p>
      ) : share && !share.ok ? (
        <div className={styles.fallback}>
          <p className={styles.warn}>
            {share.reason === 'empty' ? t('shareEmpty') : t('shareTooLarge')}
          </p>
          {share.reason === 'too-large' ? (
            <p className={styles.hint}>
              {t('shareTooLargeHint', { size: (share.bytes / 1024).toFixed(1) })}
            </p>
          ) : null}
          <div className={styles.actions}>
            <Button variant="outlined" size="m" onClick={copyTextFallback}>
              {t('shareCopyText')}
            </Button>
          </div>
        </div>
      ) : graphic && share?.ok ? (
        <div className={styles.body}>
          <div className={styles.qrCard}>
            <svg
              className={styles.qr}
              viewBox={`-2 -2 ${graphic.count + 4} ${graphic.count + 4}`}
              role="img"
              aria-label={t('shareTitle')}
            >
              <path d={graphic.path} fill="#0b0d12" shapeRendering="crispEdges" />
            </svg>
          </div>
          <div className={styles.meta}>
            <span className={styles.title} title={session.title}>
              {session.title || t('untitledChat')}
            </span>
            <span className={styles.sub}>
              {t('shareSummary', {
                count: share.messages,
                size: (share.bytes / 1024).toFixed(1),
              })}
            </span>
            <p className={styles.hint}>{t('shareHint')}</p>
            <div className={styles.actions}>
              <Button variant="primary" size="m" onClick={copyLink}>
                {t('shareCopyLink')}
              </Button>
              <Button variant="outlined" size="m" onClick={saveImage}>
                {t('shareSaveImage')}
              </Button>
            </div>
          </div>
          <canvas ref={canvasRef} className={styles.canvas} />
        </div>
      ) : (
        <p className={styles.warn}>{t('shareInvalid')}</p>
      )}
    </Modal>
  )
}

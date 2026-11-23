import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { ArtifactMeta } from '../../services/agent/types.js'
import {
  downloadArtifact,
  formatBytes,
  loadArtifactText,
} from '../../services/agent/artifacts.js'
import { Modal } from '../base/Modal.js'
import { Button } from '../base/Button.js'
import { IconDownloadOutline16 } from '../base/icons.js'
import { IconSpark } from './ToolIcons.js'
import styles from './WidgetCard.module.css'

/** 片段补成完整文档，保证背景与基础字体一致 */
const buildSrcDoc = (html: string) => {
  if (/<html[\s>]/i.test(html)) {
    return html
  }
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<style>',
    'html,body{margin:0;padding:0;background:#fff;color:#111;',
    'font:14px/1.65 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}',
    '*,*::before,*::after{box-sizing:border-box;}',
    '</style></head><body>',
    html,
    '</body></html>',
  ].join('')
}

const WidgetFrame = ({ html, title }: { html: string; title: string }) => (
  <iframe
    className={styles.frame}
    srcDoc={buildSrcDoc(html)}
    sandbox="allow-scripts allow-forms"
    referrerPolicy="no-referrer"
    title={title}
  />
)

/** 模型生成的交互组件：消息里直接渲染，可展开或下载 */
export const WidgetCard = ({ meta }: { meta: ArtifactMeta }) => {
  const t = useTranslate()
  const [html, setHtml] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [open, setOpen] = useState(false)
  const title = meta.name.replace(/\.widget\.html$/i, '') || t('agentWidgetTitle')

  useEffect(() => {
    let alive = true
    void loadArtifactText(meta.id).then((value) => {
      if (!alive) {
        return
      }
      setHtml(value)
      setMissing(value === null)
    })
    return () => {
      alive = false
    }
  }, [meta.id])

  return (
    <div className={styles.widget}>
      <div className={styles.head}>
        <span className={styles.badge}>
          <IconSpark />
        </span>
        <span className={styles.title}>{title}</span>
        <span className={styles.hint}>
          {t('agentWidgetHint')} · {formatBytes(meta.size)}
        </span>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t('agentArtifactDownload')}
          onClick={() => {
            void downloadArtifact(meta)
          }}
        >
          <IconDownloadOutline16 />
        </button>
        <button type="button" className={styles.expand} onClick={() => setOpen(true)}>
          {t('agentWidgetExpand')}
        </button>
      </div>
      <div className={styles.stage}>
        {html ? (
          <WidgetFrame html={html} title={title} />
        ) : (
          <div className={missing ? styles.empty : styles.skeleton}>
            {missing ? t('agentWidgetEmpty') : t('agentWidgetLoading')}
          </div>
        )}
      </div>
      {open && html ? (
        <Modal
          title={<span className={styles.modalTitle}>{title}</span>}
          onClose={() => setOpen(false)}
          closable
          className={styles.modal}
          mainClassName={styles.modalMain}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => setOpen(false)}>
                {t('agentArtifactClose')}
              </Button>
              <Button
                variant="primary"
                size="m"
                onClick={() => {
                  void downloadArtifact(meta)
                }}
              >
                {t('agentArtifactDownload')}
              </Button>
            </>
          }
        >
          <div className={styles.modalStage}>
            <WidgetFrame html={html} title={title} />
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { ArtifactMeta } from '../../services/agent/types.js'
import {
  downloadArtifact,
  formatBytes,
  getArtifactUrl,
  loadArtifactText,
} from '../../services/agent/artifacts.js'
import { Markdown } from '../markdown/Markdown.js'
import { Modal } from '../base/Modal.js'
import { Button } from '../base/Button.js'
import { IconDownloadOutline16 } from '../base/icons.js'
import { IconCode, IconFile, IconGlobe, IconTerminal } from './ToolIcons.js'
import styles from './ArtifactCard.module.css'

const kindLabel: Record<ArtifactMeta['kind'], string> = {
  markdown: 'Markdown',
  text: 'Text',
  html: 'HTML',
  widget: 'Widget',
  json: 'JSON',
  csv: 'CSV',
  code: 'Code',
  image: 'Image',
  binary: 'File',
}

const KindIcon = ({ kind }: { kind: ArtifactMeta['kind'] }) => {
  switch (kind) {
    case 'html':
    case 'markdown':
      return <IconGlobe />
    case 'code':
      return <IconCode />
    case 'csv':
    case 'json':
      return <IconTerminal />
    default:
      return <IconFile />
  }
}

/** 文件产物卡片：点击预览，右上角直接下载 */
export const ArtifactCard = ({
  meta,
  className,
}: {
  meta: ArtifactMeta
  className?: string
}) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <>
      <div className={clsx(styles.card, className)}>
        <button type="button" className={styles.main} onClick={() => setOpen(true)}>
          <span className={styles.icon}>
            <KindIcon kind={meta.kind} />
          </span>
          <span className={styles.info}>
            <span className={styles.name}>{meta.name}</span>
            <span className={styles.meta}>
              {kindLabel[meta.kind]} · {formatBytes(meta.size)}
            </span>
          </span>
          <span className={styles.preview}>{t('agentArtifactPreview')}</span>
        </button>
        <button
          type="button"
          className={styles.download}
          aria-label={t('agentArtifactDownload')}
          onClick={async () => {
            const ok = await downloadArtifact(meta)
            setFailed(!ok)
          }}
        >
          <IconDownloadOutline16 />
        </button>
        {failed ? <span className={styles.error}>{t('agentArtifactEmpty')}</span> : null}
      </div>
      {open ? <ArtifactPreview meta={meta} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

/** 预览弹窗：文本类直接渲染，HTML 用沙箱 iframe，图片用 img */
export const ArtifactPreview = ({
  meta,
  onClose,
}: {
  meta: ArtifactMeta
  onClose: () => void
}) => {
  const t = useTranslate()
  const [text, setText] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      if (meta.kind === 'image' || meta.kind === 'html') {
        const next = await getArtifactUrl(meta.id)
        if (alive) {
          setUrl(next)
          setMissing(!next)
        }
        return
      }
      const next = await loadArtifactText(meta.id)
      if (alive) {
        setText(next)
        setMissing(next === null)
      }
    })()
    return () => {
      alive = false
    }
  }, [meta.id, meta.kind])

  const body = () => {
    if (missing) {
      return <div className={styles.empty}>{t('agentArtifactEmpty')}</div>
    }
    if (meta.kind === 'image') {
      return url ? <img className={styles.image} src={url} alt={meta.name} /> : null
    }
    if (meta.kind === 'html') {
      return url ? (
        <iframe className={styles.frame} src={url} sandbox="allow-scripts allow-forms" title={meta.name} />
      ) : null
    }
    if (text === null) {
      return null
    }
    if (meta.kind === 'markdown') {
      return (
        <div className={styles.markdown}>
          <Markdown content={text} loading={false} cacheKey={meta.id} disableLink={false} />
        </div>
      )
    }
    return <pre className={styles.code}>{text}</pre>
  }

  return (
    <Modal
      title={
        <span className={styles.modalTitle}>
          <span className={styles.modalName}>{meta.name}</span>
          <span className={styles.modalMeta}>
            {kindLabel[meta.kind]} · {formatBytes(meta.size)}
          </span>
        </span>
      }
      onClose={onClose}
      closable
      className={styles.modal}
      mainClassName={styles.modalMain}
      footer={
        <>
          <Button variant="outlined" size="m" onClick={onClose}>
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
      {body()}
    </Modal>
  )
}

import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { ArtifactKind } from '../../services/agent/types.js'
import {
  downloadArtifact,
  formatBytes,
  getArtifactUrl,
  loadArtifactText,
} from '../../services/agent/artifacts.js'
import { Markdown } from '../markdown/Markdown.js'
import { IconDownloadOutline16, IconRightUpOutline14 } from '../base/icons.js'
import { IconCode, IconFile, IconGlobe, IconTerminal } from './ToolIcons.js'
import styles from './PreviewCard.module.css'

/** preview_file 写进工具结果 meta 的描述，历史消息回放时也够用 */
export type PreviewMeta = {
  /** 本地产物 id；与 url 二选一 */
  id?: string
  /** 远程地址，网页预览用 */
  url?: string
  name: string
  kind: ArtifactKind
  mime?: string
  size?: number
  /** 说明文字 */
  caption?: string
}

const KindIcon = ({ kind }: { kind: ArtifactKind }) => {
  switch (kind) {
    case 'html':
      return <IconGlobe />
    case 'code':
      return <IconCode />
    case 'json':
    case 'csv':
      return <IconTerminal />
    default:
      return <IconFile />
  }
}

/**
 * 回答底部的内联预览：代码、图片、网页直接在这里看，
 * 不用再点开产物卡片。内容从 IndexedDB 或远程地址懒加载。
 */
export const PreviewCard = ({ preview }: { preview: PreviewMeta }) => {
  const t = useTranslate()
  const [text, setText] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    if (preview.url) {
      setUrl(preview.url)
      return
    }
    if (!preview.id) {
      return
    }
    void getArtifactUrl(preview.id).then((next) => {
      if (active) {
        setUrl(next)
      }
    })
    if (preview.kind === 'markdown' || preview.kind === 'text' || preview.kind === 'json' || preview.kind === 'csv' || preview.kind === 'code') {
      void loadArtifactText(preview.id).then((next) => {
        if (active) {
          setText(next)
        }
      })
    }
    return () => {
      active = false
    }
  }, [preview.id, preview.url, preview.kind])

  const caption = preview.caption ? <span className={styles.caption}>{preview.caption}</span> : null

  return (
    <section className={styles.card}>
      <header className={styles.head}>
        <span className={styles.icon}>
          <KindIcon kind={preview.kind} />
        </span>
        <span className={styles.name} title={preview.name}>
          {preview.name}
        </span>
        <span className={styles.meta}>
          {t('previewTitle')}
          {preview.size ? ` · ${formatBytes(preview.size)}` : ''}
        </span>
        <span className={styles.spacer} />
        {preview.url ? (
          <a className={styles.link} href={preview.url} target="_blank" rel="noopener noreferrer">
            {t('previewOpen')}
            <IconRightUpOutline14 />
          </a>
        ) : null}
        {preview.id ? (
          <button
            type="button"
            className={styles.link}
            onClick={async () => {
              const ok = await downloadArtifact({
                id: preview.id as string,
                name: preview.name,
                kind: preview.kind,
                mime: preview.mime ?? 'application/octet-stream',
                size: preview.size ?? 0,
                createdAt: Date.now(),
                source: 'browser',
              })
              setFailed(!ok)
            }}
          >
            <IconDownloadOutline16 />
            {t('previewDownload')}
          </button>
        ) : null}
      </header>

      {caption}

      <div className={styles.body} data-kind={preview.kind}>
        {preview.kind === 'image' && url ? (
          <img className={styles.image} src={url} alt={preview.name} />
        ) : preview.kind === 'html' && url ? (
          <iframe
            className={styles.frame}
            src={url}
            title={preview.name}
            // 不给 same-origin，预览里的脚本拿不到应用自己的存储
            sandbox="allow-scripts allow-popups allow-forms"
            referrerPolicy="no-referrer"
          />
        ) : preview.kind === 'markdown' && text !== null ? (
          <div className={styles.markdown}>
            <Markdown content={text} loading={false} cacheKey={`preview-${preview.id}`} disableLink />
          </div>
        ) : text !== null ? (
          <pre className={styles.code}>{text.slice(0, 6000)}</pre>
        ) : failed ? (
          <div className={styles.failed}>{t('previewEmpty')}</div>
        ) : (
          <div className={clsx(styles.skeleton)} aria-hidden />
        )}
      </div>
    </section>
  )
}

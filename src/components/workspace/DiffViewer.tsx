import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useTheme } from '../../app/theme.js'
import type { FileDiff } from '../../services/workspace/diff.js'
import styles from './DiffViewer.module.css'

type Editor = import('monaco-editor').editor.IStandaloneDiffEditor

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  mdx: 'markdown',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  rb: 'ruby',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  xml: 'xml',
  svg: 'xml',
}

const languageOf = (path: string) => {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return LANGUAGE_BY_EXT[ext] ?? 'plaintext'
}

/** Monaco diff 预览：左原文右改动，红删绿加 */
export const DiffViewer = ({
  diff,
  sideBySide,
  onSetSideBySide,
  onDiscard,
}: {
  diff: FileDiff
  sideBySide: boolean
  onSetSideBySide: (value: boolean) => void
  onDiscard: () => void
}) => {
  const t = useTranslate()
  const theme = useTheme()
  const holder = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const modelsRef = useRef<{ original: import('monaco-editor').editor.ITextModel; modified: import('monaco-editor').editor.ITextModel } | null>(null)
  const [ready, setReady] = useState(false)

  // 动态加载 Monaco，首屏不为编辑器买单
  useEffect(() => {
    let cancelled = false
    void import('../../services/workspace/monaco.js').then(({ monaco, ensureThemes }) => {
      if (cancelled || !holder.current) {
        return
      }
      ensureThemes()
      const original = monaco.editor.createModel('', 'plaintext')
      const modified = monaco.editor.createModel('', 'plaintext')
      modelsRef.current = { original, modified }
      const editor = monaco.editor.createDiffEditor(holder.current, {
        readOnly: true,
        originalEditable: false,
        renderSideBySide: sideBySide,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderOverviewRuler: false,
        renderIndicators: true,
        fontSize: 12,
        lineHeight: 20,
        fontFamily:
          "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
        diffWordWrap: 'off',
        ignoreTrimWhitespace: false,
        padding: { top: 10, bottom: 10 },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        renderMarginRevertIcon: false,
        useInlineViewWhenSpaceIsLimited: false,
      })
      editor.setModel({ original, modified })
      editorRef.current = editor
      // 弹窗打开时容器从 0 撑开，automaticLayout 偶尔测不到首帧尺寸
      const observer = new ResizeObserver(() => editor.layout())
      observer.observe(holder.current)
      observerRef.current = observer
      setReady(true)
    })
    return () => {
      cancelled = true
      observerRef.current?.disconnect()
      observerRef.current = null
      editorRef.current?.dispose()
      editorRef.current = null
      modelsRef.current?.original.dispose()
      modelsRef.current?.modified.dispose()
      modelsRef.current = null
    }
    // 只创建一次，后续内容与主题走更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const models = modelsRef.current
    const editor = editorRef.current
    if (!ready || !models || !editor) {
      return
    }
    const language = languageOf(diff.path)
    if (models.original.getLanguageId() !== language) {
      // setModelLanguage 会重建 tokenizer 状态，切文件时才需要
      import('../../services/workspace/monaco.js').then(({ monaco }) => {
        monaco.editor.setModelLanguage(models.original, language)
        monaco.editor.setModelLanguage(models.modified, language)
      })
    }
    if (models.original.getValue() !== diff.original) {
      models.original.setValue(diff.original)
    }
    if (models.modified.getValue() !== diff.modified) {
      models.modified.setValue(diff.modified)
    }
    editor.updateOptions({ renderSideBySide: sideBySide })
  }, [diff, sideBySide, ready])

  useEffect(() => {
    if (!ready) {
      return
    }
    void import('../../services/workspace/monaco.js').then(({ monaco }) => {
      monaco.editor.setTheme(theme === 'dark' ? 'ds-dark' : 'ds-light')
    })
  }, [theme, ready])

  return (
    <section className={styles.viewer}>
      <header className={styles.bar}>
        <span className={styles.path} title={diff.path}>
          {diff.path}
        </span>
        <span className={styles.status} data-status={diff.status}>
          {diff.status === 'added' ? 'A' : diff.status === 'deleted' ? 'D' : 'M'}
        </span>
        <span className={styles.add}>+{diff.additions}</span>
        <span className={styles.del}>−{diff.deletions}</span>
        <span className={styles.spacer} />
        <button type="button" className={styles.discard} onClick={onDiscard}>
          {t('workspaceDiscard')}
        </button>
        <span className={styles.layout} role="group" aria-label={t('workspaceLayoutHint')}>
          <button
            type="button"
            data-active={sideBySide}
            onClick={() => onSetSideBySide(true)}
          >
            {t('workspaceSideBySide')}
          </button>
          <button
            type="button"
            data-active={!sideBySide}
            onClick={() => onSetSideBySide(false)}
          >
            {t('workspaceInline')}
          </button>
        </span>
      </header>
      <div ref={holder} className={styles.editor} data-loading={!ready} />
      {!ready ? <div className={styles.loading}>{t('workspaceLoadingEditor')}</div> : null}
    </section>
  )
}

import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { addPrompt, removePrompt, usePrompts } from '../../services/prompts.js'
import { Button } from '../base/Button.js'
import styles from './Settings.module.css'

/** 自定义提示词管理：新增、查看、删除；内容只在本地保存 */
export const PromptsSetting = () => {
  const t = useTranslate()
  const prompts = usePrompts((state) => state.list)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')

  const submit = () => {
    if (!content.trim()) {
      return
    }
    addPrompt(name, content)
    setName('')
    setContent('')
    setAdding(false)
  }

  return (
    <div className={styles.cell}>
      <div className={styles.promptHead}>
        <div className={styles.text}>
          <div className={styles.label}>{t('promptsTitle')}</div>
          <div className={styles.description}>{t('promptsHint')}</div>
        </div>
        <Button variant="outlined" size="s" onClick={() => setAdding((value) => !value)}>
          {t('promptsAdd')}
        </Button>
      </div>

      {adding ? (
        <div className={styles.promptForm}>
          <input
            className={styles.promptName}
            value={name}
            placeholder={t('promptsNamePlaceholder')}
            aria-label={t('promptsName')}
            onChange={(event) => setName(event.target.value)}
          />
          <textarea
            className={styles.promptInput}
            rows={3}
            value={content}
            placeholder={t('promptsContentPlaceholder')}
            aria-label={t('promptsContent')}
            onChange={(event) => setContent(event.target.value)}
          />
          <div className={styles.promptActions}>
            <Button variant="outlined" size="s" onClick={() => setAdding(false)}>
              {t('promptsCancel')}
            </Button>
            <Button variant="primary" size="s" disabled={!content.trim()} onClick={submit}>
              {t('promptsSave')}
            </Button>
          </div>
        </div>
      ) : null}

      {prompts.length === 0 ? (
        <div className={styles.description}>{t('promptsEmpty')}</div>
      ) : (
        <div className={styles.promptList}>
          {prompts.map((prompt) => (
            <div key={prompt.id} className={styles.promptRow}>
              <span className={styles.promptRowText}>
                <span className={styles.promptRowName}>{prompt.name}</span>
                <span className={styles.promptRowContent}>
                  {prompt.content.replace(/\s+/g, ' ').slice(0, 90)}
                </span>
              </span>
              <button
                type="button"
                className={styles.promptDelete}
                onClick={() => removePrompt(prompt.id)}
              >
                {t('promptsDelete')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

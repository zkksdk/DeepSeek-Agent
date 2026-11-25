import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  MEMORY_CHAR_LIMIT,
  MEMORY_INDEX_LIMIT,
  loadAll,
  remove,
  update,
  useMemory,
} from '../../services/memory/store.js'
import { Button } from '../base/Button.js'
import { SettingCell } from './SettingCell.js'
import styles from './Settings.module.css'

const TYPE_LABEL: Record<string, string> = {
  user: '用户偏好',
  feedback: '纠正',
  project: '项目决策',
  reference: '参考来源',
}

/**
 * 记忆面板。
 *
 * 记忆是模型自己写的，但它会写错。用户必须能看见每一条、能改、能删，
 * 否则记错了没人纠正，错误会一直累积下去。
 */
export const MemorySetting = () => {
  const t = useTranslate()
  const list = useMemory((state) => state.list)
  const ready = useMemory((state) => state.ready)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!ready) {
      void loadAll()
    }
  }, [ready])

  // 索引会占多少 token 量级：按字符数估，中文一字约 1 token
  const indexChars = list
    .slice(0, MEMORY_INDEX_LIMIT)
    .reduce((sum, item) => sum + item.title.length + 8, 0)
  const usage = indexChars > MEMORY_CHAR_LIMIT ? MEMORY_CHAR_LIMIT : indexChars

  return (
    <div className={styles.section}>
      <SettingCell
        label={t('memoryIndexTitle')}
        description={t('memoryIndexHint')
          .replace('{count}', String(list.length))
          .replace('{usage}', String(usage))
          .replace('{limit}', String(MEMORY_CHAR_LIMIT))}
        status={null}
        action={<span className={styles.memoryHits}>{list.length}</span>}
      />

      {!ready ? (
        <div className={styles.sectionEmpty}>{t('memoryLoading')}</div>
      ) : list.length === 0 ? (
        <div className={styles.sectionEmpty}>{t('memoryEmpty')}</div>
      ) : (
        list.map((item) => (
          <div key={item.id} className={styles.memoryItem}>
            <div className={styles.memoryHead}>
              <span className={styles.memoryType}>{TYPE_LABEL[item.type] ?? item.type}</span>
              <span className={styles.memoryTitle}>{item.title}</span>
              <span className={styles.memoryHits}>
                {item.workspaceId ? t('memoryScopeWorkspace') : t('memoryScopeGlobal')} · 用过{' '}
                {item.hits} 次
              </span>
            </div>

            {editing === item.id ? (
              <div className={styles.memoryEdit}>
                <textarea
                  className={styles.memoryTextarea}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <div className={styles.memoryActions}>
                  <Button
                    variant="outlined"
                    onClick={() => {
                      setEditing(null)
                      setDraft('')
                    }}
                  >
                    {t('memoryCancel')}
                  </Button>
                  <Button
                    onClick={() => {
                      void update(item.id, { body: draft })
                      setEditing(null)
                      setDraft('')
                    }}
                  >
                    {t('memorySave')}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className={styles.memoryBody}>{item.body}</div>
                <div className={styles.memoryActions}>
                  <Button
                    variant="outlined"
                    onClick={() => {
                      setEditing(item.id)
                      setDraft(item.body)
                    }}
                  >
                    {t('memoryEdit')}
                  </Button>
                  <Button variant="outlined" onClick={() => void remove(item.id)}>
                    {t('memoryDelete')}
                  </Button>
                </div>
              </>
            )}
          </div>
        ))
      )}
    </div>
  )
}

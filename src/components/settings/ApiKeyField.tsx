import { useState } from 'react'
import { IconEditOutline16 } from '../base/icons.js'
import { useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { IconButton } from '../base/IconButton.js'
import { useApiKeyForm } from './useApiKeyForm.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './Settings.module.css'

/** 鸿蒙壳注入的原生桥；浏览器里没有 */
declare global {
  interface ShellWindow extends Window {
    __DS_SHELL__?: { login: () => void; notify: (title: string, body: string) => Promise<boolean> }
  }
}
type ShellWindow = Window & { __DS_SHELL__?: { login: () => void } }

/** API Key 的编辑状态：输入框与移动端底部的「确定」按钮共用 */
export const useApiKeyEditor = () => {
  const apiKey = useSettings((state) => state.apiKey)
  const [editing, setEditing] = useState(false)
  const form = useApiKeyForm(() => setEditing(false))
  return { apiKey, editing, setEditing, form, showInput: !apiKey || editing }
}

type ApiKeyEditor = ReturnType<typeof useApiKeyEditor>

/** API Key：保存后只显示掩码，点编辑按钮才能重新输入 */
export const ApiKeyField = ({ editor }: { editor: ApiKeyEditor }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const { apiKey, editing, setEditing, form, showInput } = editor

  return (
    <div className={styles.cell}>
      <div className={styles.apiKey}>
        <div className={styles.label}>{t('apiKeyStart')}</div>
        {apiKey && !editing ? (
          <div className={styles.apiKeySaved}>
            <span className={styles.apiKeyMask}>{'*'.repeat(apiKey.length)}</span>
            <IconButton
              tone="primary"
              icon={<IconEditOutline16 />}
              tooltip={t('apiKeyEdit')}
              onClick={() => setEditing(true)}
            />
          </div>
        ) : (
          <div className={styles.apiKeyInput}>
            <input
              type="password"
              placeholder={t('apiKeyPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              // 移动端打开设置时不弹键盘，点编辑后才聚焦
              autoFocus={!isMobile || editing}
              value={form.value}
              onChange={(event) => form.setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  void form.submit()
                }
              }}
              onBlur={() => {
                // 修改时没输入就离开，回到已保存的状态
                if (apiKey && !form.value.trim()) {
                  setEditing(false)
                }
              }}
            />
            {!isMobile && form.value.trim() ? (
              <>
                <span className={styles.divider} />
                <button
                  type="button"
                  className={styles.confirm}
                  disabled={form.verifying}
                  // 保持输入框焦点
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void form.submit()}
                >
                  {form.verifying ? t('apiKeyVerifying') : t('confirm')}
                </button>
              </>
            ) : null}
          </div>
        )}
        {showInput && form.error ? <div className={styles.error}>{form.error}</div> : null}
      </div>
    </div>
  )
}

/** 移动端：输入 API Key 时在选项下方显示整行「确定」 */
export const ApiKeyConfirm = ({ editor: { showInput, form } }: { editor: ApiKeyEditor }) => {
  const t = useTranslate()
  return showInput && form.value.trim() ? (
    <button
      type="button"
      className={styles.mobileConfirm}
      disabled={form.verifying}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => void form.submit()}
    >
      {form.verifying ? t('apiKeyVerifying') : t('confirm')}
    </button>
  ) : null
}

/**
 * DeepSeek 账号：手机壳里可以用账号登录，换来的 token 以 `dsh:` 前缀存进同一个
 * apiKey 字段 —— 壳里会把它改写成 `x-dsh-auth-token` 请求头。
 *
 * 未登录时显示登录入口；已登录时只报状态。浏览器里没有原生桥，所以直说不可用，
 * 而不是给一个按了没反应的按钮。
 */
export const AccountField = () => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKey)
  const shell = typeof window === 'undefined' ? undefined : (window as ShellWindow).__DS_SHELL__
  const signedIn = apiKey.startsWith('dsh:')

  return (
    <div className={styles.cell}>
      <div className={styles.apiKey}>
        <div className={styles.label}>{t('accountLabel')}</div>
        {signedIn ? (
          <div className={styles.apiKeySaved}>
            <span className={styles.accountState}>{t('accountSignedIn')}</span>
            <span className={styles.accountDot} aria-hidden="true" />
          </div>
        ) : shell ? (
          <button
            type="button"
            className={styles.accountLogin}
            onClick={() => shell.login()}
          >
            {t('accountSignIn')}
          </button>
        ) : (
          <div className={styles.accountHint}>{t('accountShellOnly')}</div>
        )}
      </div>
    </div>
  )
}

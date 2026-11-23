import { useEffect, useRef } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { cancelPrompt, submitPrompt, usePromptDialog } from '../../services/platform/dialog.js'
import { Button } from './Button.js'
import { Modal } from './Modal.js'

/** 全局文本输入弹窗：替代 window.prompt，移动端与原生壳通用 */
export const PromptDialog = () => {
  const t = useTranslate()
  const options = usePromptDialog((state) => state.options)
  const value = usePromptDialog((state) => state.value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!options) {
      return
    }
    const timer = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 50)
    return () => clearTimeout(timer)
  }, [options])

  if (!options) {
    return null
  }

  return (
    <Modal
      title={options.title}
      closable
      onClose={cancelPrompt}
      footer={
        <>
          <Button variant="outlined" onClick={cancelPrompt}>
            {t('cancel')}
          </Button>
          <Button variant="primary" onClick={submitPrompt}>
            {t('confirm')}
          </Button>
        </>
      }
    >
      {options.description ? (
        <div style={{ fontSize: 13, lineHeight: '20px', opacity: 0.7 }}>{options.description}</div>
      ) : null}
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={options.placeholder}
        onChange={(event) => usePromptDialog.setState({ value: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            submitPrompt()
          }
          if (event.key === 'Escape') {
            cancelPrompt()
          }
        }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          height: 42,
          marginTop: 12,
          padding: '0 16px',
          borderRadius: 21,
          border: '1px solid var(--dsw-alias-border-l2)',
          background: 'transparent',
          color: 'inherit',
          fontSize: 14,
          outline: 'none',
        }}
      />
    </Modal>
  )
}

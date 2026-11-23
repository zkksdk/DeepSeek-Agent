import { useTranslate } from '../../i18n/index.js'
import { usePrompts } from '../../services/prompts.js'
import { PillPicker } from './PillPicker.js'
import { IconClipboard } from '../agent/ToolIcons.js'

/**
 * 提示词选择器：把保存好的常用指令插到输入框光标处。
 * 只做插入，不直接发送，用户还能补上这一轮的具体条件。
 */
export const PromptPicker = ({ onInsert }: { onInsert: (text: string) => void }) => {
  const t = useTranslate()
  const prompts = usePrompts((state) => state.list)
  if (prompts.length === 0) {
    return null
  }
  return (
    <PillPicker
      icon={<IconClipboard />}
      value={null}
      options={prompts.map((prompt) => ({
        value: prompt.id,
        label: prompt.name,
        description: prompt.content.replace(/\s+/g, ' ').slice(0, 60),
        hint: t('promptsUse'),
      }))}
      onChange={(id) => {
        const prompt = prompts.find((item) => item.id === id)
        if (prompt) {
          onInsert(prompt.content)
        }
      }}
    />
  )
}

/**
 * 平台能力适配层（文本输入弹窗）。
 * 用应用内弹窗替代 window.prompt：样式统一、移动端可用、原生壳下也能工作。
 */
import { create } from 'zustand'

export type PromptOptions = {
  title: string
  description?: string
  placeholder?: string
  defaultValue?: string
}

type PromptState = {
  options: PromptOptions | null
  value: string
  resolve: ((value: string | null) => void) | null
}

export const usePromptDialog = create<PromptState>(() => ({
  options: null,
  value: '',
  resolve: null,
}))

/** 打开输入弹窗，返回用户输入（取消为 null） */
export const promptText = (options: PromptOptions): Promise<string | null> =>
  new Promise((resolve) => {
    usePromptDialog.setState({ options, value: options.defaultValue ?? '', resolve })
  })

export const submitPrompt = () => {
  const { value, resolve } = usePromptDialog.getState()
  resolve?.(value)
  usePromptDialog.setState({ options: null, value: '', resolve: null })
}

export const cancelPrompt = () => {
  const { resolve } = usePromptDialog.getState()
  resolve?.(null)
  usePromptDialog.setState({ options: null, value: '', resolve: null })
}

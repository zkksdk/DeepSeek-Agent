import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'

/** 设置弹窗的分组：通用 / 外观与动效 / Agent / 工作区 / 数据 */
export type SettingsSection = 'general' | 'appearance' | 'agent' | 'workspace' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 没有 API Key 时打开设置并选中 API Key 所在的「数据管理」，返回是否已有 Key */
export const ensureApiKey = () => {
  const { apiKey, mockAgent } = useSettings.getState()
  // 演示模式走本地脚本化模型，不需要 Key 也能体验完整链路
  if (apiKey || mockAgent) {
    return true
  }
  openSettings('data')
  return false
}

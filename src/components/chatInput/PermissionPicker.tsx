import { useTranslate } from '../../i18n/index.js'
import { setToolApproval, useSettings } from '../../services/settings.js'
import { PillPicker } from './PillPicker.js'
import { IconShield, IconShieldFull } from '../base/icons.js'

/**
 * 权限选择器：放在输入框工具栏里，发消息前一眼能看到当前是「默认权限」还是「完全访问」。
 * 之前在设置里，用户经常不知道自己处于哪种模式。
 */
export const PermissionPicker = () => {
  const t = useTranslate()
  const approval = useSettings((state) => state.toolApproval)
  return (
    <PillPicker
      icon={approval === 'auto' ? <IconShieldFull /> : <IconShield />}
      value={approval}
      accent={approval === 'auto' ? 'warn' : 'brand'}
      options={[
        {
          value: 'ask',
          label: t('permissionDefault'),
          description: t('permissionDefaultHint'),
          icon: <IconShield />,
        },
        {
          value: 'auto',
          label: t('permissionFull'),
          description: t('permissionFullHint'),
          icon: <IconShieldFull />,
        },
      ]}
      onChange={(value) => setToolApproval(value === 'auto' ? 'auto' : 'ask')}
    />
  )
}

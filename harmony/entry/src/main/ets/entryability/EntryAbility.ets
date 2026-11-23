import { AbilityConstant, UIAbility, Want, abilityAccessCtrl, Permissions } from '@kit.AbilityKit'
import { hilog } from '@kit.PerformanceAnalysisKit'
import { window } from '@kit.ArkUI'

const DOMAIN: number = 0x0000
const TAG: string = 'DSChat'

/**
 * 需要用户点同意的那几项。INTERNET / GET_NETWORK_INFO 是普通权限，装机即授予。
 * 定位与麦克风只在 web 端真用到时才触发系统弹窗，这里提前问一次，省得聊到一半被打断。
 */
const RUNTIME_PERMISSIONS: Permissions[] = [
  'ohos.permission.APPROXIMATELY_LOCATION',
  'ohos.permission.LOCATION',
  'ohos.permission.MICROPHONE',
]

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'onCreate: %{public}s', want.bundleName ?? '')
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, TAG, 'loadContent failed: %{public}s', JSON.stringify(err))
        return
      }
      this.requestRuntimePermissions()
    })
  }

  onDestroy(): void {
    hilog.info(DOMAIN, TAG, 'onDestroy')
  }

  private requestRuntimePermissions(): void {
    const manager = abilityAccessCtrl.createAtManager()
    manager
      .requestPermissionsFromUser(this.context, RUNTIME_PERMISSIONS)
      .then((result) => {
        hilog.info(DOMAIN, TAG, 'permission results: %{public}s', JSON.stringify(result.authResults))
      })
      .catch((error: Error) => {
        hilog.error(DOMAIN, TAG, 'permission request failed: %{public}s', error.message)
      })
  }
}

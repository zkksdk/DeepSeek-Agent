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
    // 沉浸式全屏：网页底色要铺到状态栏和导航栏后面，所以窗口不缩进安全区。
    // 内容怎么避让交给页面自己处理（见 Index.ets 的顶部留白）。
    windowStage.getMainWindow().then((win) => {
      win.setWindowLayoutFullScreen(true).catch((error: Error) => {
        hilog.warn(DOMAIN, TAG, 'fullscreen failed: %{public}s', error.message)
      })
      win.setWindowSystemBarProperties({
        statusBarColor: '#00000000',
        navigationBarColor: '#00000000',
        // 背景透明以后，状态栏和导航栏的前景必须指定为浅色，
        // 否则系统按深色画，压在深色页面上等于看不见。
        isStatusBarLightIcon: true,
        statusBarContentColor: '#FFFFFF',
        isNavigationBarLightIcon: true,
        navigationBarContentColor: '#FFFFFF',
      }).catch((error: Error) => {
        hilog.warn(DOMAIN, TAG, 'system bar failed: %{public}s', error.message)
      })
    }).catch((error: Error) => {
      hilog.warn(DOMAIN, TAG, 'main window failed: %{public}s', error.message)
    })
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

/**
 * 地址栏路由。
 *
 * 形态：
 *   #/                             新对话
 *   #/s/<id>                       某个会话
 *   #/s/<id>/settings/<section>    在会话上叠一层设置
 *   #/settings/<section>           在新对话上叠一层设置
 *   #/share/<payload>              打开二维码分享的对话
 *
 * 之前所有状态都只活在内存里，刷新就回到欢迎页；这一层把它写进地址栏，
 * 同时让「设置」「分享」这类浮层也能单独分享链接。
 *
 * 用 pushState 而不是改 location.hash：hash 赋值会额外触发一次 hashchange，
 * 双向同步时容易自己触发自己。这里只监听 popstate（前进/后退）。
 */

import { useSyncExternalStore } from 'react'
import { closeSettings, useSettingsDialog, type SettingsSection } from '../components/settings/settingsDialogState.js'
import { initChat, newChat, selectSession, useChatStore } from '../services/chat/store.js'
import { showToast } from '../components/base/toastState.js'

export type Route =
  | { kind: 'new' }
  | { kind: 'session'; id: string }
  | { kind: 'settings'; section: SettingsSection; sessionId: string | null }
  | { kind: 'share'; payload: string }

const SECTIONS: SettingsSection[] = ['general', 'appearance', 'agent', 'workspace', 'data']

const isSection = (value: string): value is SettingsSection =>
  (SECTIONS as string[]).includes(value)

const decode = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export const parseRoute = (hash: string): Route => {
  const path = hash.replace(/^#/, '')
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) {
    return { kind: 'new' }
  }
  if (parts[0] === 'share' && parts[1]) {
    return { kind: 'share', payload: decode(parts.slice(1).join('/')) }
  }
  if (parts[0] === 'settings') {
    return {
      kind: 'settings',
      section: parts[1] && isSection(parts[1]) ? parts[1] : 'general',
      sessionId: null,
    }
  }
  if (parts[0] === 's' && parts[1]) {
    const id = decode(parts[1])
    if (parts[2] === 'settings') {
      return {
        kind: 'settings',
        section: parts[3] && isSection(parts[3]) ? parts[3] : 'general',
        sessionId: id,
      }
    }
    return { kind: 'session', id }
  }
  return { kind: 'new' }
}

export const routeToHash = (route: Route): string => {
  switch (route.kind) {
    case 'session':
      return `#/s/${encodeURIComponent(route.id)}`
    case 'settings':
      return route.sessionId
        ? `#/s/${encodeURIComponent(route.sessionId)}/settings/${route.section}`
        : `#/settings/${route.section}`
    case 'share':
      return `#/share/${route.payload}`
    default:
      return '#/'
  }
}

/** 当前地址对应的路由 */
export const currentRoute = (): Route => parseRoute(window.location.hash)

/** 路由快照：界面要跟着地址栏走（比如分享页），不能只在 store 里改 */
let snapshot: Route = currentRoute()
const listeners = new Set<() => void>()
const publish = (route: Route) => {
  snapshot = route
  for (const listener of [...listeners]) {
    listener()
  }
}
const subscribeRoute = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const useRoute = () => useSyncExternalStore(subscribeRoute, () => snapshot, () => snapshot)

export const navigate = (route: Route, replace = false) => {
  const hash = routeToHash(route)
  if (window.location.hash === hash) {
    return
  }
  // 地址栏是共享状态，写历史时保留 title 与滚动位置
  if (replace) {
    window.history.replaceState(null, '', hash)
  } else {
    window.history.pushState(null, '', hash)
  }
  publish(route)
}

/**
 * 同一段路由可能由三个来源触发：地址栏、会话切换、设置开关。
 * applying 用来标记「这次是自己写的地址」，避免回环。
 */
let applying = false
/** 深链接指向的会话还没加载完时先记住，initChat 之后再补 */
let pendingSessionId: string | null = null

const withSession = (sessionId: string | null, section: SettingsSection): Route =>
  sessionId
    ? { kind: 'settings', sessionId, section }
    : { kind: 'settings', sessionId: null, section }

/** 把地址栏读到的东西落到 store 上 */
const applyRoute = (route: Route) => {
  applying = true
  publish(route)
  try {
    switch (route.kind) {
      case 'session': {
        closeSettings()
        const { ready, sessions } = useChatStore.getState()
        if (!ready) {
          pendingSessionId = route.id
          return
        }
        if (sessions.some((session) => session.id === route.id)) {
          if (useChatStore.getState().activeId !== route.id) {
            selectSession(route.id)
          }
          return
        }
        // 会话被删了或链接来自别的设备：回到新对话，不要停在空白页
        pendingSessionId = null
        newChat()
        navigate({ kind: 'new' }, true)
        showToast({ key: 'routeSessionMissing', type: 'error' })
        return
      }
      case 'new': {
        closeSettings()
        newChat()
        return
      }
      case 'settings': {
        if (route.sessionId) {
          const { ready, sessions } = useChatStore.getState()
          if (!ready) {
            // 列表还没读完：先记住目标会话，就绪后由订阅补上
            pendingSessionId = route.sessionId
          } else if (sessions.some((session) => session.id === route.sessionId)) {
            if (useChatStore.getState().activeId !== route.sessionId) {
              selectSession(route.sessionId)
            }
          } else {
            pendingSessionId = null
            newChat()
          }
        } else {
          newChat()
        }
        useSettingsDialog.setState({ open: true, section: route.section })
        return
      }
      case 'share': {
        closeSettings()
        // 分享页由 ShareView 自己消费 payload，这里只负责清掉其它浮层
        newChat()
        return
      }
    }
  } finally {
    applying = false
  }
}

/** store 变化后回写地址栏；地址相同则什么都不做（navigate 内部有判断） */
const syncFromStore = () => {
  if (applying) {
    return
  }
  const route = currentRoute()
  const activeId = useChatStore.getState().activeId
  const dialog = useSettingsDialog.getState()

  if (dialog.open) {
    // 设置打开时，只更新 section，不动底下的会话
    if (route.kind !== 'settings') {
      navigate(withSession(activeId, dialog.section))
    } else if (route.section !== dialog.section) {
      navigate(withSession(route.sessionId ?? activeId, dialog.section), true)
    }
    return
  }

  if (route.kind === 'share') {
    // 分享页上如果有了活动会话（导入完成，或用户从侧栏另选了对话），就离开分享页
    if (activeId !== null) {
      navigate({ kind: 'session', id: activeId }, true)
    }
    return
  }

  if (activeId === null) {
    if (route.kind !== 'new') {
      navigate({ kind: 'new' }, true)
    }
    return
  }
  if (route.kind !== 'session' || route.id !== activeId) {
    navigate({ kind: 'session', id: activeId }, true)
  }
}

let started = false

/** App 启动时调用一次 */
export const initRouter = () => {
  if (started) {
    return
  }
  started = true

  applyRoute(currentRoute())

  window.addEventListener('popstate', () => {
    applyRoute(currentRoute())
    // 前进/后退回到设置页时，浮层要跟着地址走
    const route = currentRoute()
    if (route.kind !== 'settings') {
      closeSettings()
    }
  })

  useChatStore.subscribe((state, previous) => {
    if (state.activeId !== previous.activeId) {
      if (pendingSessionId !== null && state.activeId === pendingSessionId) {
        pendingSessionId = null
      }
      syncFromStore()
    }
    // 列表加载完再补一次：深链接指向的会话要等 sessions 就绪
    if (state.ready && !previous.ready) {
      const route = currentRoute()
      if (route.kind === 'settings' && route.sessionId) {
        pendingSessionId = route.sessionId
      }
      if (pendingSessionId !== null) {
        const target = pendingSessionId
        pendingSessionId = null
        if (state.sessions.some((session) => session.id === target)) {
          selectSession(target)
        } else {
          navigate({ kind: 'new' }, true)
          showToast({ key: 'routeSessionMissing', type: 'error' })
        }
      }
    }
  })

  useSettingsDialog.subscribe((state, previous) => {
    if (state.open !== previous.open || state.section !== previous.section) {
      syncFromStore()
    }
  })

  // 首次进入就带 #/s/xxx 时，initChat 由 App 发起，这里只等列表
  void initChat()
}

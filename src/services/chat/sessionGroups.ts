import { translate } from '../../i18n/index.js'
import { monthKey } from '../../utils/format.js'
import type { SessionSummary } from './types.js'

const DAY = 86_400_000

const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0)

/** 分组：今天 / 昨天 / 7 天内 / 30 天内 / 按月 */
export const groupSessions = (sessions: SessionSummary[], now: number, t = translate) => {
  const groups: { key: string; label: string; sessions: SessionSummary[] }[] = []
  for (const session of sessions) {
    const diff = Math.floor((now - startOfDay(session.updatedAt)) / DAY)
    const key =
      diff <= 0
        ? 'sessionHistoryTimelineLabelToday'
        : diff <= 1
          ? 'sessionHistoryTimelineLabelYesterday'
          : diff < 7
            ? 'sessionHistoryTimelineLabel7days'
            : diff < 30
              ? 'sessionHistoryTimelineLabel30days'
              : null
    const groupKey = key ?? monthKey(session.updatedAt) ?? ''
    const last = groups.at(-1)
    if (last?.key === groupKey) {
      last.sessions.push(session)
    } else {
      groups.push({ key: groupKey, label: key ? t(key) : groupKey, sessions: [session] })
    }
  }
  return groups
}

/**
 * 按工作区分组。
 *
 * 会话建的时候记下 workspaceId，这里按它归类。没有 workspaceId 的旧会话
 * 归到 ungrouped——不能丢，也不能硬塞进某个工作区。
 */
export type WorkspaceGroup = {
  key: string
  name: string
  sessions: SessionSummary[]
}

export const groupSessionsByWorkspace = (
  sessions: SessionSummary[],
  workspaces: { id: string; name: string }[],
  ungroupedLabel: string
): WorkspaceGroup[] => {
  // 以工作区列表为准：新建的空工作区也要显示出来，不能等到有会话才出现
  const groups: WorkspaceGroup[] = workspaces.map((item) => ({
    key: item.id,
    name: item.name,
    sessions: [],
  }))
  const byId = new Map(groups.map((group) => [group.key, group]))
  const orphan = { key: '__none__', name: ungroupedLabel, sessions: [] as SessionSummary[] }

  for (const session of sessions) {
    const id = session.workspaceId ?? '__none__'
    const group = byId.get(id) ?? orphan
    group.sessions.push(session)
  }

  const result = orphan.sessions.length > 0 ? [...groups, orphan] : groups
  // 有会话的排前面，空的往后放，同组内按名字
  return result.sort((a, b) => {
    if (a.key === '__none__') return 1
    if (b.key === '__none__') return -1
    if (a.sessions.length !== b.sessions.length) return b.sessions.length - a.sessions.length
    return a.name.localeCompare(b.name)
  })
}

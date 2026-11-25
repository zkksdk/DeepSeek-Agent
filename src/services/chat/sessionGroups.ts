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
  const byId = new Map(workspaces.map((item) => [item.id, item.name]))
  const groups = new Map<string, WorkspaceGroup>()

  for (const session of sessions) {
    const id = session.workspaceId ?? '__none__'
    let group = groups.get(id)
    if (!group) {
      group = { key: id, name: byId.get(id) ?? ungroupedLabel, sessions: [] }
      groups.set(id, group)
    }
    group.sessions.push(session)
  }

  // 有名字的工作区排前面，「未分组」垫底
  return [...groups.values()].sort((a, b) => {
    if (a.key === '__none__') return 1
    if (b.key === '__none__') return -1
    return a.name.localeCompare(b.name)
  })
}

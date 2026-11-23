import { create } from 'zustand'
import type { ApprovalDecision, ApprovalRequest } from './types.js'

type ApprovalState = {
  /** 等待用户处理的审批，先进先出 */
  queue: ApprovalRequest[]
  /** 本会话内允许的工具（按 sessionId + 工具名） */
  sessionAllowed: Set<string>
}

export const useApprovals = create<ApprovalState>(() => ({
  queue: [],
  sessionAllowed: new Set(),
}))

const resolvers = new Map<string, (decision: ApprovalDecision) => void>()

const sessionKey = (request: ApprovalRequest) => `${request.sessionId}:${request.toolName}`

/**
 * 请求审批：返回的 Promise 由界面的确认框解决。
 * 会话内已允许过的工具直接放行，避免连续操作反复打断。
 */
export const requestApproval = (request: ApprovalRequest): Promise<ApprovalDecision> => {
  if (useApprovals.getState().sessionAllowed.has(sessionKey(request))) {
    return Promise.resolve('allow_once')
  }
  return new Promise<ApprovalDecision>((resolve) => {
    resolvers.set(request.id, resolve)
    useApprovals.setState((state) => ({ queue: [...state.queue, request] }))
  })
}

export const resolveApproval = (id: string, decision: ApprovalDecision) => {
  const request = useApprovals.getState().queue.find((item) => item.id === id)
  if (request && decision === 'allow_session') {
    useApprovals.setState((state) => ({
      sessionAllowed: new Set(state.sessionAllowed).add(sessionKey(request)),
    }))
  }
  useApprovals.setState((state) => ({ queue: state.queue.filter((item) => item.id !== id) }))
  resolvers.get(id)?.(decision)
  resolvers.delete(id)
}

/** 停止生成或切换会话时清空，未处理的审批按拒绝收尾 */
export const clearApprovals = (predicate: (request: ApprovalRequest) => boolean = () => true) => {
  const { queue } = useApprovals.getState()
  const targets = queue.filter(predicate)
  if (targets.length === 0) {
    return
  }
  useApprovals.setState((state) => ({ queue: state.queue.filter((item) => !targets.includes(item)) }))
  for (const request of targets) {
    resolvers.get(request.id)?.('deny')
    resolvers.delete(request.id)
  }
}

export const resetSessionApprovals = (sessionId: string) => {
  useApprovals.setState((state) => ({
    sessionAllowed: new Set(
      [...state.sessionAllowed].filter((key) => !key.startsWith(`${sessionId}:`))
    ),
  }))
}

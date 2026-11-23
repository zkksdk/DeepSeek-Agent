import { create } from 'zustand'

/** 分享弹窗：同一时间只服务一个会话 */
export const useShareDialog = create<{ sessionId: string | null }>(() => ({ sessionId: null }))

export const openShare = (sessionId: string) => useShareDialog.setState({ sessionId })

export const closeShare = () => useShareDialog.setState({ sessionId: null })

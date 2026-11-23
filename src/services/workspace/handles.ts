import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

/**
 * 本地工作区目录句柄的持久化。
 * FileSystemDirectoryHandle 不能写进 localStorage，只能放 IndexedDB，
 * 刷新后用 queryPermission 判断是否还需要用户重新授权。
 */
type WorkspaceSchema = DBSchema & {
  handles: {
    key: string
    value: { id: string; handle: FileSystemDirectoryHandle; savedAt: number }
  }
}

let db: Promise<IDBPDatabase<WorkspaceSchema>> | null = null

const connect = () => {
  db ??= openDB<WorkspaceSchema>('agent-workspaces', 1, {
    upgrade(instance) {
      instance.createObjectStore('handles', { keyPath: 'id' })
    },
  })
  return db
}

export const saveHandle = async (id: string, handle: FileSystemDirectoryHandle) => {
  try {
    const instance = await connect()
    await instance.put('handles', { id, handle, savedAt: Date.now() })
  } catch {
    // 浏览器不支持或被拒绝时只在当前会话可用
  }
}

export const loadHandle = async (id: string) => {
  try {
    const instance = await connect()
    const record = await instance.get('handles', id)
    return record?.handle ?? null
  } catch {
    return null
  }
}

export const deleteHandle = async (id: string) => {
  try {
    const instance = await connect()
    await instance.delete('handles', id)
  } catch {
    // 忽略删除失败
  }
}

/** FileSystemHandle 的权限方法不在默认 lib 里，这里按需取用 */
type PermissibleHandle = FileSystemDirectoryHandle & {
  queryPermission?: (options: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (options: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
}

/** 重新打开页面后句柄通常处于 prompt 状态，需要用户手势才能恢复读写权限 */
export const ensurePermission = async (handle: FileSystemDirectoryHandle) => {
  const target = handle as PermissibleHandle
  const query = target.queryPermission?.bind(handle)
  const request = target.requestPermission?.bind(handle)
  if (!query) {
    return true
  }
  const state = await query({ mode: 'readwrite' })
  if (state === 'granted') {
    return true
  }
  if (state === 'denied' || !request) {
    return false
  }
  return (await request({ mode: 'readwrite' })) === 'granted'
}

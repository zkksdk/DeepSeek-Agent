/** 读取本地仓库的 .git 元数据：当前分支与分支列表 */
export type GitInfo = {
  branch: string
  branches: string[]
}

const readTextFile = async (dir: FileSystemDirectoryHandle, name: string) => {
  try {
    const handle = await dir.getFileHandle(name)
    return await (await handle.getFile()).text()
  } catch {
    return null
  }
}

const listBranchRefs = async (
  dir: FileSystemDirectoryHandle,
  prefix = ''
): Promise<string[]> => {
  const names: string[] = []
  try {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'directory') {
        names.push(...(await listBranchRefs(handle, prefix + name + '/')))
      } else {
        names.push(prefix + name)
      }
    }
  } catch {
    return names
  }
  return names
}

/** 解析 .git/HEAD、refs/heads 与 packed-refs，拿不到就返回 null */
export const readGitInfo = async (root: FileSystemDirectoryHandle): Promise<GitInfo | null> => {
  let gitDir: FileSystemDirectoryHandle
  try {
    gitDir = await root.getDirectoryHandle('.git')
  } catch {
    return null
  }

  const head = (await readTextFile(gitDir, 'HEAD'))?.trim() ?? ''
  const branches = new Set<string>()

  try {
    const refs = await gitDir.getDirectoryHandle('refs')
    const heads = await refs.getDirectoryHandle('heads')
    for (const name of await listBranchRefs(heads)) {
      branches.add(name)
    }
  } catch {
    // 没有 refs 目录时只依赖 packed-refs
  }

  const packed = await readTextFile(gitDir, 'packed-refs')
  if (packed) {
    for (const line of packed.split('\n')) {
      const match = /^[0-9a-f]{40}\s+refs\/heads\/(.+)$/.exec(line.trim())
      if (match) {
        branches.add(match[1])
      }
    }
  }

  let branch = ''
  const ref = /^ref:\s+refs\/heads\/(.+)$/.exec(head)
  if (ref) {
    branch = ref[1]
    branches.add(branch)
  } else if (/^[0-9a-f]{40}$/.test(head)) {
    branch = 'HEAD@' + head.slice(0, 7)
  }

  if (!branch) {
    branch = [...branches][0] ?? 'main'
  }
  return { branch, branches: [...branches].sort() }
}

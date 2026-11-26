import { defineTool, fail, objectSchema, ok, str, clip } from '../toolKit.js'
import { diffFile, diffWorkspace, unifiedDiff } from '../../workspace/diff.js'
import {
  createBranch,
  deleteWorkspaceFile,
  setBranch,
  workspaceSnapshot,
  writeWorkspaceFile,
} from '../../workspace/store.js'
import type { RegisteredTool, ToolContext } from '../types.js'

const MAX_READ = 30_000
const MAX_DIFF = 6_000

/** 只读取工作区内的相对路径 */
const safePath = (input: Record<string, unknown>) => {
  const raw = str(input, 'path').trim().replace(/^\.\//, '').replace(/^\/+/, '')
  if (!raw || raw.split('/').some((part) => !part || part === '.' || part === '..')) {
    return null
  }
  return raw
}

const statusMark = (status: string) =>
  status === 'added' ? 'A' : status === 'deleted' ? 'D' : 'M'

/**
 * 工作区：读和写分成两个工具。
 *
 * 八个细碎的动作（list/read/write/edit/delete/search/diff/branch）按「是否改数据」
 * 分成两个入口。分成两个而不是一个，是因为 requiresApproval 是工具级静态开关，
 * 合在一起会让「读一个文件」也要用户点确认。
 */

const listFiles = () => {
  const snapshot = workspaceSnapshot()
  if (!snapshot) {
    return fail('工作区还没有打开。请让用户先在工作区面板里选择一个文件夹。')
  }
  const changes = diffWorkspace(snapshot.base, snapshot.files)
  const total = Object.keys(snapshot.files).length
  const lines = [
    `工作区：${snapshot.root}（${snapshot.source === 'demo' ? '演示仓库' : '本地目录'}）`,
    `分支：${snapshot.branch}${
      snapshot.branches.length > 1
        ? `（可切换：${snapshot.branches.filter((name) => name !== snapshot.branch).join('、')}）`
        : ''
    }`,
    `文件：${total} 个，其中 ${changes.length} 个有改动`,
  ]
  if (changes.length === 0) {
    lines.push('工作树干净，没有未提交改动。')
  } else {
    lines.push('变更：')
    for (const item of changes) {
      lines.push(`- ${statusMark(item.status)} ${item.path} (+${item.additions} −${item.deletions})`)
    }
  }
  return ok(lines.join('\n'))
}

const readFile = (input: Record<string, unknown>) => {
  const snapshot = workspaceSnapshot()
  if (!snapshot) {
    return fail('工作区还没有打开。')
  }
  const path = safePath(input)
  if (!path) {
    return fail('路径不合法，请传相对路径，不能包含 ..')
  }
  const content = snapshot.files[path]
  if (content === undefined) {
    return fail(`文件不存在：${path}。可以先用 action=list 查看有哪些文件。`)
  }
  return ok(`文件：${path}\n\n${clip(content, MAX_READ)}`)
}

const searchFiles = (input: Record<string, unknown>) => {
  const snapshot = workspaceSnapshot()
  if (!snapshot) {
    return fail('工作区还没有打开。')
  }
  const query = str(input, 'query')
  if (!query) {
    return fail('query 不能为空。')
  }
  const prefix = str(input, 'path_prefix').trim()
  const rows: string[] = []
  for (const [filePath, content] of Object.entries(snapshot.files)) {
    if (prefix && !filePath.startsWith(prefix)) {
      continue
    }
    content.split(/\r?\n/).forEach((line, index) => {
      if (line.includes(query)) {
        rows.push(`${filePath}:${index + 1}: ${clip(line.trim(), 140)}`)
      }
    })
  }
  if (rows.length === 0) {
    return ok(`没有文件包含「${query}」。`)
  }
  const head = rows.slice(0, 60).join('\n')
  const tail = rows.length > 60 ? `\n…还有 ${rows.length - 60} 处` : ''
  return ok(`${rows.length} 处命中：\n${head}${tail}`)
}

const diffFileOrAll = (input: Record<string, unknown>) => {
  const snapshot = workspaceSnapshot()
  if (!snapshot) {
    return fail('工作区还没有打开。')
  }
  const path = str(input, 'path').trim()
  const total = diffWorkspace(snapshot.base, snapshot.files)
  if (!path) {
    if (total.length === 0) {
      return ok('工作树干净，没有改动。')
    }
    return ok(
      `${total.length} 个文件有改动：\n` +
        total
          .map((item) => `- ${statusMark(item.status)} ${item.path} (+${item.additions} −${item.deletions})`)
          .join('\n')
    )
  }
  const one = diffFile(path, snapshot.base, snapshot.files)
  if (one.status === 'unchanged') {
    return ok(`${path} 没有改动。`)
  }
  const text = unifiedDiff(one)
  return ok(`${statusMark(one.status)} ${path} (+${one.additions} −${one.deletions})\n\n${clip(text, MAX_DIFF)}`)
}

export const workspaceTools: RegisteredTool[] = [
  defineTool(
    {
      name: 'workspace',
      label: '工作区（只读）',
      description:
        '查看工作区：action=list 列分支与变更；read 读文件；search 在文件内容里搜；diff 看改动。改文件用 workspace_edit。',
      inputSchema: objectSchema(
        {
          action: {
            type: 'string',
            enum: ['list', 'read', 'search', 'diff'],
            description: 'list 列文件 / read 读文件 / search 搜内容 / diff 看改动',
          },
          path: { type: 'string', description: 'action=read 或 diff 时的相对路径' },
          query: { type: 'string', description: 'action=search 时要搜的文本' },
          path_prefix: { type: 'string', description: 'action=search 时只看这个目录' },
        },
        ['action']
      ),
      risk: 'safe',
      icon: 'folder',
    },
    async (input) => {
      const action = str(input, 'action', 'list')
      if (action === 'read') {
        return readFile(input)
      }
      if (action === 'search') {
        return searchFiles(input)
      }
      if (action === 'diff') {
        return diffFileOrAll(input)
      }
      return listFiles()
    }
  ),

  defineTool(
    {
      name: 'workspace_edit',
      label: '工作区（写入）',
      description:
        '改工作区：action=write 整篇写入（也可新建）；edit 精确替换一段（首选，改一行就用它）；delete 删掉文件；branch 切分支。会立即反映在工作区面板，执行前需要用户确认。',
      inputSchema: objectSchema(
        {
          action: {
            type: 'string',
            enum: ['write', 'edit', 'delete', 'branch'],
            description: 'write 整篇写 / edit 精确替换 / delete 删除 / branch 切分支',
          },
          path: { type: 'string', description: '相对路径，例如 src/agent/loop.ts' },
          content: { type: 'string', description: 'action=write 时的完整内容' },
          old_string: { type: 'string', description: 'action=edit 时被替换的原文，必须唯一' },
          new_string: { type: 'string', description: 'action=edit 时替换成的文本' },
          replace_all: { type: 'boolean', description: 'action=edit 时替换全部匹配' },
          branch_action: { type: 'string', enum: ['switch', 'create'], description: 'action=branch 时切或建' },
          name: { type: 'string', description: 'action=branch 时的分支名' },
        },
        ['action']
      ),
      risk: 'write',
      requiresApproval: true,
      icon: 'file',
    },
    async (input, context: ToolContext) => {
      const snapshot = workspaceSnapshot()
      if (!snapshot) {
        return fail('工作区还没有打开。')
      }
      const action = str(input, 'action', 'write')

      if (action === 'branch') {
        const name = str(input, 'name').trim()
        if (!name) {
          return fail('分支名不能为空。')
        }
        if (str(input, 'branch_action', 'switch') === 'create') {
          const created = createBranch(name)
          return created ? ok(`已新建并切到分支 ${name}`) : fail(`分支已存在或无法新建：${name}`)
        }
        if (!snapshot.branches.includes(name)) {
          return fail(`没有这个分支：${name}。可先用 workspace action=list 查看可用分支。`)
        }
        await setBranch(name)
        return ok(`已切到分支 ${name}`)
      }

      if (!snapshot.writable) {
        return fail('当前工作区不可写。')
      }
      const path = safePath(input)
      if (!path) {
        return fail('路径不合法，请传相对路径，不能包含 ..')
      }

      if (action === 'delete') {
        const deleted = await deleteWorkspaceFile(path)
        if (!deleted) {
          return fail(`工作区里没有这个文件：${path}`)
        }
        const after = workspaceSnapshot()
        const remaining = after ? diffWorkspace(after.base, after.files).length : 0
        return ok(`已删除 ${path}。当前还有 ${remaining} 个文件有改动。`)
      }

      if (action === 'edit') {
        const oldText = str(input, 'old_string')
        const newText = str(input, 'new_string')
        if (!oldText) {
          return fail('old_string 不能为空。')
        }
        const current = snapshot.files[path]
        if (current === undefined) {
          return fail(`文件不存在：${path}。新建文件用 action=write。`)
        }
        const hits = current.split(oldText).length - 1
        if (hits === 0) {
          return fail(`在 ${path} 里没找到这段文本，先读一遍确认原文。`)
        }
        const replaceAll = input.replace_all === true
        if (hits > 1 && !replaceAll) {
          return fail(
            `这段文本在 ${path} 里出现了 ${hits} 次，无法确定改哪一处。把 old_string 写长一点带上上下文，或传 replace_all。`
          )
        }
        const next = replaceAll ? current.split(oldText).join(newText) : current.replace(oldText, () => newText)
        context.progress(`编辑 ${path}…`)
        await writeWorkspaceFile(path, next)
        const diff = diffFile(path, snapshot.base, { ...snapshot.files, [path]: next })
        return ok(`已修改 ${path}（${hits} 处）。累计 +${diff.additions} −${diff.deletions}。`)
      }

      if (typeof input.content !== 'string') {
        return fail('content 必须是字符串')
      }
      context.progress(`写入 ${path}…`)
      await writeWorkspaceFile(path, input.content)
      const after = workspaceSnapshot()
      if (!after) {
        return ok(`已写入 ${path}`)
      }
      const diff = diffFile(path, after.base, after.files)
      return ok(
        `${diff.status === 'added' ? '新建' : '更新'} ${path}：+${diff.additions} −${diff.deletions}\n` +
          `当前分支 ${after.branch} 共 ${diffWorkspace(after.base, after.files).length} 个文件有改动。`
      )
    }
  ),
]

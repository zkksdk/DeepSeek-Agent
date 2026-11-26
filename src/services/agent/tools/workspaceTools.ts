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

/** 只接受工作区内的相对路径 */
const safePath = (input: Record<string, unknown>) => {
  const raw = str(input, 'path').trim().replace(/^\.\//, '').replace(/^\/+/, '')
  if (!raw || raw.split('/').some((part) => !part || part === '.' || part === '..')) {
    return null
  }
  return raw
}

const statusMark = (status: string) =>
  status === 'added' ? 'A' : status === 'deleted' ? 'D' : 'M'

const snapshotOrFail = () => {
  const snapshot = workspaceSnapshot()
  if (!snapshot) {
    return null
  }
  return snapshot
}

export const workspaceTools: RegisteredTool[] = [
  defineTool(
    {
      name: 'workspace_list_files',
      label: '列出工作区',
      description:
        '列出当前工作区的分支、变更文件与增删行数。改动来自用户打开的工作树；写文件前先用它确认路径。',
      inputSchema: objectSchema({}),
      risk: 'safe',
      icon: 'folder',
    },
    async () => {
      const snapshot = snapshotOrFail()
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
          lines.push(
            `- ${statusMark(item.status)} ${item.path} (+${item.additions} −${item.deletions})`
          )
        }
      }
      return ok(lines.join('\n'))
    }
  ),

  defineTool(
    {
      name: 'workspace_read_file',
      label: '读取工作区文件',
      description: '读取工作区里的一个文本文件。路径为相对路径，例如 src/agent/loop.ts。',
      inputSchema: objectSchema({ path: { type: 'string', description: '相对工作区根目录的路径' } }, [
        'path',
      ]),
      risk: 'safe',
      icon: 'file',
    },
    async (input) => {
      const snapshot = snapshotOrFail()
      if (!snapshot) {
        return fail('工作区还没有打开。')
      }
      const path = safePath(input)
      if (!path) {
        return fail('路径不合法，请传相对路径，不能包含 ..')
      }
      const content = snapshot.files[path]
      if (content === undefined) {
        return fail(`文件不存在：${path}。可以先用 workspace_list_files 查看变更文件。`)
      }
      return ok(`文件：${path}\n\n${clip(content, MAX_READ)}`)
    }
  ),

  defineTool(
    {
      name: 'workspace_write_file',
      label: '写入工作区文件',
      description:
        '把完整内容写入工作区文件，允许新建文件。会立即出现在工作区面板的 diff 里；写入前需要用户确认。',
      inputSchema: objectSchema(
        {
          path: { type: 'string', description: '相对路径，例如 src/agent/loop.ts' },
          content: { type: 'string', description: '文件的完整新内容' },
        },
        ['path', 'content']
      ),
      risk: 'write',
      requiresApproval: true,
      icon: 'file',
    },
    async (input, context: ToolContext) => {
      const snapshot = snapshotOrFail()
      if (!snapshot) {
        return fail('工作区还没有打开。')
      }
      const path = safePath(input)
      if (!path) {
        return fail('路径不合法，请传相对路径，不能包含 ..')
      }
      if (typeof input.content !== 'string') {
        return fail('content 必须是字符串')
      }
      if (!snapshot.writable) {
        return fail('当前工作区不可写，请让用户重新选择一个文件夹并授权写入。')
      }
      context.progress(`写入 ${path}…`)
      await writeWorkspaceFile(path, input.content)
      const after = workspaceSnapshot()
      if (!after) {
        return ok(`已写入 ${path}`)
      }
      const diff = diffFile(path, after.base, after.files)
      const lines = [
        `${diff.status === 'added' ? '新建' : '更新'} ${path}：+${diff.additions} −${diff.deletions}`,
        `当前分支 ${after.branch} 共 ${diffWorkspace(after.base, after.files).length} 个文件有改动。`,
      ]
      return ok(lines.join('\n'), { meta: { path, additions: diff.additions, deletions: diff.deletions } })
    }
  ),

  defineTool(
    {
      name: 'workspace_delete_file',
      label: '删除工作区文件',
      description:
        '从工作区里彻底删掉一个文件（不是清空内容）。会同步删掉沙箱里的实体，文件从面板和磁盘上一起消失；删除前需要用户确认。',
      inputSchema: objectSchema(
        {
          path: { type: 'string', description: '相对路径，例如 test/rw-check.md' },
        },
        ['path']
      ),
      risk: 'write',
      requiresApproval: true,
      icon: 'file',
    },
    async (input, context: ToolContext) => {
      const snapshot = snapshotOrFail()
      if (!snapshot) {
        return fail('工作区还没有打开。')
      }
      const path = safePath(input)
      if (!path) {
        return fail('路径不合法，请传相对路径，不能包含 ..')
      }
      if (!snapshot.writable) {
        return fail('当前工作区不可写。')
      }
      context.progress(`删除 ${path}…`)
      const deleted = await deleteWorkspaceFile(path)
      if (!deleted) {
        return fail(`工作区里没有这个文件：${path}`)
      }
      const after = workspaceSnapshot()
      const remaining = after ? diffWorkspace(after.base, after.files).length : 0
      return ok(`已删除 ${path}。当前还有 ${remaining} 个文件有改动。`)
    }
  ),

  defineTool(
    {
      name: 'workspace_edit_file',
      label: '编辑工作区文件',
      description:
        '把文件里的某段文本替换掉，不用整篇重写。old_string 必须在文件里唯一，否则会拒绝执行——这样可以避免改错地方。改一行就用它，别用 workspace_write_file 覆盖整篇。',
      inputSchema: objectSchema(
        {
          path: { type: 'string', description: '相对路径，例如 src/agent/loop.ts' },
          old_string: { type: 'string', description: '要被替换的原文，必须唯一' },
          new_string: { type: 'string', description: '替换后的文本，传空字符串表示删除这段' },
          replace_all: { type: 'boolean', description: '为 true 时替换全部匹配（默认 false，要求唯一）' },
        },
        ['path', 'old_string', 'new_string']
      ),
      risk: 'write',
      requiresApproval: true,
      icon: 'file',
    },
    async (input, context: ToolContext) => {
      const snapshot = snapshotOrFail()
      if (!snapshot) {
        return fail('工作区还没有打开。')
      }
      const path = safePath(input)
      if (!path) {
        return fail('路径不合法，请传相对路径，不能包含 ..')
      }
      if (!snapshot.writable) {
        return fail('当前工作区不可写。')
      }
      const oldText = str(input, 'old_string')
      const newText = str(input, 'new_string')
      const replaceAll = input.replace_all === true
      if (!oldText) {
        return fail('old_string 不能为空。')
      }
      const current = snapshot.files[path]
      if (current === undefined) {
        return fail(`文件不存在：${path}。新建文件请用 workspace_write_file。`)
      }
      const hits = current.split(oldText).length - 1
      if (hits === 0) {
        return fail(`在 ${path} 里没找到这段文本，先读一遍确认原文。`)
      }
      if (hits > 1 && !replaceAll) {
        return fail(`这段文本在 ${path} 里出现了 ${hits} 次，无法确定改哪一处。把 old_string 写长一点带上上下文，或传 replace_all。`)
      }
      const next = replaceAll
        ? current.split(oldText).join(newText)
        : current.replace(oldText, () => newText)
      context.progress(`编辑 ${path}…`)
      await writeWorkspaceFile(path, next)
      const diff = diffFile(path, snapshot.base, { ...snapshot.files, [path]: next })
      return ok(`已修改 ${path}（${hits} 处）。累计 +${diff.additions} −${diff.deletions}。`)
    }
  ),

  defineTool(
    {
      name: 'workspace_search',
      label: '搜索工作区内容',
      description:
        '在工作区的文件内容里搜文本，返回命中的文件、行号和那一行。想知道某个函数/字符串在哪个文件里时先搜一下，比挨个读快得多。',
      inputSchema: objectSchema(
        {
          query: { type: 'string', description: '要搜的文本，普通子串匹配' },
          path_prefix: { type: 'string', description: '可选，只看这个目录下的文件' },
        },
        ['query']
      ),
      risk: 'safe',
      icon: 'search',
    },
    async (input) => {
      const snapshot = snapshotOrFail()
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
        const fileLines = content.split(/\r?\n/)
        fileLines.forEach((line, index) => {
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
  ),

  defineTool(
    {
      name: 'workspace_switch_branch',
      label: '切换工作区分支',
      description:
        '切换工作区当前分支，或基于当前工作树新建分支（仅内置演示仓库）。切换后基线与文件树整组替换，diff 会按新分支重算。',
      inputSchema: objectSchema(
        {
          action: { type: 'string', enum: ['switch', 'create'], description: '切换或新建' },
          name: { type: 'string', description: '分支名，例如 feat/workspace' },
        },
        ['action', 'name']
      ),
      risk: 'write',
      requiresApproval: true,
      icon: 'folder',
    },
    async (input, context) => {
      const snapshot = snapshotOrFail()
      if (!snapshot) {
        return fail('工作区还没有打开。')
      }
      if (snapshot.source !== 'demo') {
        return fail('本地目录只读取分支信息，暂不支持切换或新建分支。')
      }
      const action = str(input, 'action')
      const name = str(input, 'name').trim()
      if (!name) {
        return fail('请提供分支名')
      }
      context.progress(action === 'create' ? `新建分支 ${name}…` : `切换到 ${name}…`)
      if (action === 'switch' && name === snapshot.branch) {
        return ok(`已经在 ${name} 上了。`)
      }
      if (action === 'create') {
        const result = createBranch(name)
        if (!result.ok) {
          return fail(
            result.error === 'exists' ? `分支已存在：${name}` : `分支名不合法：${name}`
          )
        }
        return ok(`已创建并切换到 ${name}，基线取当前工作树，因此 diff 为空。`)
      }
      if (!setBranch(name)) {
        return fail(`没有这个分支：${name}。可先用 workspace_list_files 查看可用分支。`)
      }
      const next = workspaceSnapshot()
      const changed = next ? diffWorkspace(next.base, next.files).length : 0
      return ok(`已切换到 ${name}，当前 ${changed} 个文件有改动。`)
    }
  ),

  defineTool(
    {
      name: 'workspace_diff',
      label: '查看工作区 diff',
      description:
        '查看文件相对基线的统一 diff。传 path 看单个文件；不传则返回全部变更的摘要与 diff。',
      inputSchema: objectSchema({
        path: { type: 'string', description: '可选，相对路径；省略则查看全部变更' },
      }),
      risk: 'safe',
      icon: 'code',
    },
    async (input) => {
      const snapshot = snapshotOrFail()
      if (!snapshot) {
        return fail('工作区还没有打开。')
      }
      if (input.path !== undefined && typeof input.path !== 'string') {
        return fail('path 必须是字符串')
      }
      const raw = str(input, 'path').trim()
      if (raw) {
        const path = safePath(input)
        if (!path) {
          return fail('路径不合法，请传相对路径，不能包含 ..')
        }
        if (!(path in snapshot.files) && !(path in snapshot.base)) {
          return fail(`文件不存在：${path}`)
        }
        const diff = diffFile(path, snapshot.base, snapshot.files)
        if (diff.status === 'unchanged') {
          return ok(`${path} 与基线一致，没有改动。`)
        }
        return ok(
          `${path}：${statusMark(diff.status)} +${diff.additions} −${diff.deletions}\n\n${clip(
            unifiedDiff(diff),
            MAX_DIFF
          )}`
        )
      }
      const changes = diffWorkspace(snapshot.base, snapshot.files)
      if (changes.length === 0) {
        return ok('工作树干净，没有未提交改动。')
      }
      const blocks = changes.map(
        (item) =>
          `## ${statusMark(item.status)} ${item.path} +${item.additions} −${item.deletions}\n${clip(
            unifiedDiff(item),
            Math.floor(MAX_DIFF / 2)
          )}`
      )
      return ok(blocks.join('\n\n'))
    }
  ),
]

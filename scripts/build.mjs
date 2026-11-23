#!/usr/bin/env node
/**
 * 跨平台 web 构建入口。
 *
 * 原来 package.json 里是 `rm -rf dist && NODE_ENV=production rspack build`，
 * 这两截在 Windows 的 cmd 下都不成立（没有 rm，也不支持 VAR=value 前缀），
 * rspack 配置里的 output.clean 已经负责清空，所以这里只干两件事：
 * 设好 NODE_ENV，再把参数原样转给 rspack。
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

process.env.NODE_ENV = process.env.NODE_ENV || 'production'

const passthrough = process.argv.slice(2)
const args = passthrough.length > 0 ? passthrough : ['build', '-c', 'rspack.config.ts']

// 直接调 node_modules/.bin 里的可执行，不依赖调用方（npm script / 裸 node）的 PATH
const localBin = path.resolve(
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'rspack.cmd' : 'rspack'
)
const bin = existsSync(localBin) ? localBin : 'rspack'

const result = spawnSync(bin, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}
process.exit(result.status ?? 1)

#!/usr/bin/env node
/**
 * 跨平台 web 构建入口。
 *
 * 上游 package.json 里写的是 `rm -rf dist && rspack build -c rspack.config.ts --mode production`，
 * 前半截在 Windows 的 cmd 下不存在（没有 rm）。rspack 配置里的 output.clean 已经负责清空，
 * 所以这里只做一件事：把参数转给 rspack，默认带上 --mode production。
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const passthrough = process.argv.slice(2)
const args =
  passthrough.length > 0 ? passthrough : ['build', '-c', 'rspack.config.ts', '--mode', 'production']

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

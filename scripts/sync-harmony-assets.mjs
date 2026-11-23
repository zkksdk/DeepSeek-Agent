#!/usr/bin/env node
/**
 * 把 web 构建产物同步进鸿蒙工程的 rawfile，并生成资源清单。
 *
 * 清单（_assets.json）是运行时的索引：ArkWeb 的拦截回调必须同步返回，
 * 而 rawfile 不能列目录，所以清单在构建期就把相对路径全部定下来，
 * 启动时按清单把文件落到应用沙箱，拦截时直接读沙箱（见 WebAssets.ets）。
 */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const from = path.join(root, 'dist')
const to = path.join(root, 'harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'www')

const walk = async (dir, base = '') => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const rel = base ? base + '/' + entry.name : entry.name
    if (entry.isDirectory()) {
      files.push(...(await walk(path.join(dir, entry.name), rel)))
    } else if (entry.isFile()) {
      files.push(rel)
    }
  }
  return files
}

const main = async () => {
  try {
    await stat(from)
  } catch {
    console.error('找不到 dist/，先跑 pnpm build')
    process.exit(1)
  }

  await rm(to, { recursive: true, force: true })
  await mkdir(to, { recursive: true })
  await cp(from, to, { recursive: true })

  const files = (await walk(to)).sort()
  // index.html 必须存在，否则壳里第一屏就是白屏
  if (!files.includes('index.html')) {
    console.error('dist/index.html 缺失，构建产物不完整')
    process.exit(1)
  }

  await writeFile(path.join(to, '_assets.json'), JSON.stringify(files, null, 0), 'utf8')

  const total = (
    await Promise.all(files.map(async (rel) => (await stat(path.join(to, rel))).size))
  ).reduce((sum, size) => sum + size, 0)

  console.log('已同步 ' + files.length + ' 个文件，共 ' + (total / 1024).toFixed(0) + ' KB → harmony/entry/src/main/resources/rawfile/www')
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  console.log('对应 web 版本 ' + manifest.version)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

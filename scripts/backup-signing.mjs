#!/usr/bin/env node
/**
 * 推送前自动备份鸿蒙签名密钥。
 *
 * 签名材料放在 C:\Users\<user>\.ohos\config，只有一份；
 * 丢了就得回 DevEco 重新生成，而 p7b 又绑死了包名和设备 UDID。
 * 所以每次 git push 之前先把当前这套抄一份到 F:\dev\signing-backup。
 *
 * 用法： node scripts/backup-signing.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const CONFIG_DIR = join(homedir(), '.ohos', 'config')
const BACKUP_ROOT = process.env.SIGNING_BACKUP_DIR || 'F:\\dev\\signing-backup'
const BUILD_PROFILE = join(import.meta.dirname, '..', 'harmony', 'build-profile.json5')

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const dest = join(BACKUP_ROOT, stamp)

const backup = () => {
  if (!existsSync(BUILD_PROFILE)) {
    console.log('[signing] build-profile.json5 不存在，跳过')
    return
  }
  const profile = readFileSync(BUILD_PROFILE, 'utf8')
  const start = profile.indexOf('"signingConfigs"')
  const end = profile.indexOf('"products"')
  if (start === -1 || end === -1) {
    console.log('[signing] 没找到 signingConfigs 段，跳过')
    return
  }
  const block = profile.slice(start, end)
  if (block.includes('"signingConfigs": []') || block.includes('"signingConfigs":[]')) {
    console.log('[signing] signingConfigs 为空，没有可备份的密钥')
    return
  }

  // 从配置里抽出四个文件路径
  const files = [...block.matchAll(/"([^"]+\.(?:p12|cer|p7b|csr))"/g)].map((m) => m[1])
  if (files.length === 0) {
    console.log('[signing] 配置里没有密钥文件路径，跳过')
    return
  }

  mkdirSync(dest, { recursive: true })
  let copied = 0
  const missing = []
  for (const file of files) {
    const name = file.split(/[\\/]/).pop()
    const from = join(CONFIG_DIR, name)
    const target = join(dest, name)
    if (existsSync(from)) {
      if (!existsSync(target)) {
        copyFileSync(from, target)
        copied += 1
      }
    } else if (existsSync(file)) {
      if (!existsSync(target)) {
        copyFileSync(file, target)
        copied += 1
      }
    } else {
      missing.push(name)
    }
  }

  writeFileSync(join(dest, 'signing-config.json5'), block.trim().replace(/,\s*$/, ''), 'utf8')
  writeFileSync(
    join(dest, 'README.txt'),
    [
      '鸿蒙签名备份',
      '生成时间: ' + new Date().toISOString(),
      '',
      '本目录含私钥(p12)与口令，禁止提交到任何仓库。',
      '',
      '恢复: 把 p12/cer/p7b 拷回 ~/.ohos/config/，',
      '      再把 signing-config.json5 贴回 harmony/build-profile.json5 的 signingConfigs。',
      '',
      '注意: p7b 里的 bundleName 和 UDID 固定，换包名或换设备都要重新申请。',
    ].join('\n'),
    'utf8'
  )

  console.log('[signing] 备份完成: ' + dest)
  console.log('[signing] 复制 ' + copied + ' 个文件，落盘 ' + readdirSync(dest).length + ' 项')
  if (missing.length > 0) {
    console.warn('[signing] 以下文件找不到: ' + missing.join(', '))
  }
}

backup()

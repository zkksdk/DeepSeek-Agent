/**
 * 平台能力适配层（文件保存）。
 * Web 通过 a[download] 触发浏览器下载；原生壳可替换为系统分享或写入文件系统。
 */
export const saveBlob = async (blob: Blob, filename: string): Promise<void> => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

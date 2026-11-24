import { provinces, type UserLocation } from './location.js'

/**
 * 位置信息。
 *
 * 走 HarmonyOS 自带的 LocationKit：壳里取当前位置，再用系统逆地理编码换出
 * 省 / 市，不需要接第三方地图服务，也不用联网查 IP。页面只负责把结果匹配到
 * 设置里那两张下拉表。
 *
 * 壳不可用（比如跑在普通浏览器里）或者定位失败时返回 null，用户可以手动选。
 */

/** 去掉「省」「市」「自治区」这类后缀再比 */
const strip = (value: string) =>
  value
    .replace(/[省市]$/, '')
    .replace(/壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区/, '')
    .trim()

/** 把省市名匹配到内置的省份 / 城市表 */
const matchLocation = (provinceName: string, cityName?: string): UserLocation | null => {
  const wanted = strip(provinceName)
  const found = provinces.find((item) => item.name === provinceName || strip(item.name) === wanted)
  if (!found) {
    return null
  }
  if (!cityName) {
    return { region: 'CN', province: found.code }
  }
  const wantedCity = strip(cityName)
  const city = found.cities.find(
    (item) => item.name === cityName || strip(item.name) === wantedCity
  )
  return city
    ? { region: 'CN', province: found.code, city: city.code }
    : { region: 'CN', province: found.code }
}

type ShellLocate = { locate?: () => Promise<string> }

/** 让壳定位一次，拿不到就返回 null */
export const detectLocation = async (): Promise<UserLocation | null> => {
  const shell = (window as unknown as { __DS_SHELL__?: ShellLocate }).__DS_SHELL__
  if (!shell?.locate) {
    return null
  }
  try {
    const raw = await shell.locate()
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as { region?: string; province?: string; city?: string }
    const region = parsed.region ?? 'CN'
    if (region !== 'CN') {
      return { region }
    }
    if (!parsed.province) {
      return null
    }
    return matchLocation(parsed.province, parsed.city)
  } catch {
    return null
  }
}

/**
 * 平台能力适配层（定位）。
 * Web 用浏览器 Geolocation；原生壳可替换为系统定位插件，接口保持一致。
 */

export type GeoCoords = { latitude: number; longitude: number; accuracy: number }

export const isGeolocationSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'geolocation' in navigator

export const getCurrentPosition = (options?: {
  highAccuracy?: boolean
}): Promise<GeoCoords> =>
  new Promise((resolve, reject) => {
    if (!isGeolocationSupported()) {
      reject(new Error('当前环境不支持定位'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      (error) => reject(error),
      {
        enableHighAccuracy: options?.highAccuracy === true,
        timeout: 15000,
        maximumAge: 60000,
      }
    )
  })

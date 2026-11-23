<#
  鸿蒙手机版冒烟验收。

  每次改动后用一条命令跑完：装 -> 启 -> 过权限 -> 检查日志与沙箱 -> 截图。

  用法（PowerShell 的执行策略会拦本地 .ps1，用 Bypass 跑）：
    powershell -ExecutionPolicy Bypass -File harmony\acceptance.ps1

  可选参数：
    -Device    hdc 目标，默认 127.0.0.1:5555（模拟器）
    -OutDir    截图与日志落盘目录
    -SkipInstall  只跑检查，不重装（保留已有数据）

  退出码 0 = 全部通过，1 = 有失败项。
#>
param(
  [string]$Device = "127.0.0.1:5555",
  [string]$OutDir = "",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Continue"

$Here     = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$Root     = Split-Path -Parent $Here
if ($OutDir -eq "") { $OutDir = Join-Path $Root ".out\acceptance" }
$Hdc      = "C:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe"
$Hap      = Join-Path $Here "entry\build\default\outputs\default\entry-default-unsigned.hap"
$Bundle   = "com.zkksdk.chatdemo"
$Sandbox  = "/data/app/el2/100/base/$Bundle/haps/entry/files"

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$script:Results = New-Object System.Collections.ArrayList
function Record($name, $ok, $detail) {
  # 用 ArrayList 而不是 +=：函数内对 $script: 数组做 += 会重建数组，
  # 调用方的引用可能还指向旧的，汇总时就数不到失败项（出现过假绿）。
  $okBool = [bool]$ok
  [void]$script:Results.Add([pscustomobject]@{ Check = $name; Pass = $okBool; Detail = $detail })
  $mark = if ($okBool) { "PASS" } else { "FAIL" }
  Write-Host ("[{0}] {1} {2}" -f $mark, $name, $(if ($detail) { "- $detail" } else { "" }))
}

function Hdc { & $Hdc -t $Device @args 2>&1 | Out-String }

function Snap($name) {
  $remote = "/data/local/tmp/$name.jpeg"
  $local  = Join-Path $OutDir "$name.jpeg"
  Hdc shell snapshot_display -f $remote | Out-Null
  Hdc file recv $remote $local | Out-Null
  return $local
}

function Tap($x, $y) { Hdc shell uinput -T -c $x $y | Out-Null }

# hdc 失败时也是往 stdout 写一串文本，直接判"输出非空"会把
# "[Fail]Not match target founded" 当成成功。统一走这个判断。
function HdcFailed($out) {
  return ($out -match "\[Fail\]|Not match target|error:|failed to")
}

Write-Host "=== 鸿蒙手机版验收 ==="
Write-Host "设备: $Device"
Write-Host "输出: $OutDir"
Write-Host ""

# --- 0. 环境 ---
Record "hdc 可执行" (Test-Path $Hdc) $Hdc
if (-not (Test-Path $Hdc)) { exit 1 }

# --- 本地构建检查（不依赖设备，先跑，没设备也有东西可看） ---
Record "HAP 已构建" (Test-Path $Hap) $Hap

if (Test-Path $Hap) {
  $hapMB = [math]::Round((Get-Item $Hap).Length / 1MB, 2)
  # 现在约 11 MB；超过 20 MB 基本就是把 node_modules 或 docs 打进去了
  Record "HAP 体积合理" ($hapMB -lt 20) "$hapMB MB"
}

$rawDir = Join-Path $Here "entry\src\main\resources\rawfile\www"
$manifestPath = Join-Path $rawDir "_assets.json"
if (Test-Path $manifestPath) {
  # 别用 @() 包：ConvertFrom-Json 把 JSON 数组当成一个整体对象输出，
  # 再套 @() 会变成只有 1 个元素的嵌套数组，Count 变成 1、-contains 永远为假。
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $missing = @($manifest | Where-Object { -not (Test-Path (Join-Path $rawDir $_)) })
  $hasIndex = ($manifest -contains "index.html")
  $detail = ""
  if ($missing.Count -gt 0) {
    $detail = "缺 $($missing.Count) 个，首个：$($missing[0])"
  } elseif (-not $hasIndex) {
    $detail = "清单里没有 index.html"
  } else {
    $detail = "$($manifest.Count) 个文件"
  }
  Record "资源清单与 rawfile 一致" (($missing.Count -eq 0) -and $hasIndex) $detail
} else {
  Record "资源清单与 rawfile 一致" $false "找不到 _assets.json（先跑 pnpm build:harmony）"
}

# 调试开关必须是空串，发布前最容易被忘的一步
$indexPath = Join-Path $Here "entry\src\main\ets\pages\Index.ets"
if (Test-Path $indexPath) {
  $live = Select-String -Path $indexPath -Pattern "const DEBUG_\w+: string = '[^']+'"
  $names = ($live | ForEach-Object { ($_.Line -split '=')[0].Trim() }) -join ", "
  Record "调试开关全部为空" ($null -eq $live) $names
} else {
  Record "调试开关全部为空" $false "找不到 Index.ets"
}

$targets = Hdc list targets
Record "设备已连接" ((-not (HdcFailed $targets)) -and ($targets -notmatch "Empty") -and ($targets -match $Device.Replace(":", ":"))) $targets.Trim()

if (-not $SkipInstall) {
  Hdc shell aa force-stop $Bundle | Out-Null
  Hdc uninstall $Bundle | Out-Null
  $installOut = Hdc install $Hap
  Record "安装 HAP" ($installOut -match "successfully") $installOut.Trim()
}

# --- 1. 冷启动 ---
# 两种模式都先杀一次：-SkipInstall 只是不重装，仍要看到本次运行的日志，
# 否则页面加载那一项只能跳过，每次不重装的回归就少一条。
Hdc shell aa force-stop $Bundle | Out-Null
Start-Sleep -Seconds 2
$StartedAt = (Get-Date).AddSeconds(-10)
Hdc shell aa start -a EntryAbility -b $Bundle | Out-Null
Start-Sleep -Seconds 8

# 首次装完会弹两个权限。坐标是 1320x2856（模拟器 Pura 90）下量的：
#   定位「仅使用期间允许」 (661, 2060)
#   麦克风「允许」        (947, 1732)
#
# 换分辨率或换机型必须重新量，别靠猜。可靠的量法：截图后用 System.Drawing
# 裁出目标区域放大 2 倍再读像素坐标。这一轮就因为把回形针按钮的 y 猜低了
# 150px，白点了四五次才弹出文件选择器。
if (-not $SkipInstall) {
  Tap 661 2060
  Start-Sleep -Seconds 3
  Tap 947 1732
  Start-Sleep -Seconds 3
}

Snap "01-launch" | Out-Null

# onCreate 会很快被 hilog 缓冲区冲掉，用进程存在判断是否起来了
$pidOut = Hdc shell pidof $Bundle
Record "应用启动（进程存活）" ($pidOut -match "^\s*\d+\s*$") $pidOut.Trim()

$log = Hdc shell "hilog -x"
Record "页面加载（走拦截器）" ($log -match "page end: https://app.local") ""

# --- 2. 生命周期没有被卡住（只看本次运行期间的记录） ---
$fault = Hdc shell "ls -t /data/log/faultlog/faultlogger/ 2>/dev/null"
if (HdcFailed $fault) {
  # 读不到 faultlogger 不等于"没有超时"，不能放过
  Record "本次运行无 LIFECYCLE_TIMEOUT" $false "无法读取 faultlogger"
  $fault = ""
  $faultUnreadable = $true
} else {
  $faultUnreadable = $false
}
$freezeHit = ""
foreach ($line in ($fault -split "`n")) {
  if ($line -match ("sysfreeze-" + [regex]::Escape($Bundle) + "-\d+-(\d{14})")) {
    $stamp = [datetime]::ParseExact($matches[1], "yyyyMMddHHmmss", $null)
    if ($stamp -ge $StartedAt) { $freezeHit = $line.Trim() }
  }
}
if (-not $faultUnreadable) {
  Record "本次运行无 LIFECYCLE_TIMEOUT" ($freezeHit -eq "") $freezeHit
}

# --- 3. 资源不再落沙箱副本 ---
$sandboxFiles = Hdc shell "ls $Sandbox 2>/dev/null"
$sandboxOk = (-not (HdcFailed $sandboxFiles)) -and ($sandboxFiles -notmatch "www")
Record "沙箱无 www 副本（直读 rawfile）" $sandboxOk $sandboxFiles.Trim()

# --- 4. 返回键回桌面（不是黑屏） ---
Hdc shell uinput -K -d 2 -u 2 | Out-Null
Start-Sleep -Seconds 3
$afterPid = Hdc shell pidof $Bundle
Snap "02-after-back" | Out-Null
Record "返回键后进程仍在后台" ($afterPid -match "^\s*\d+\s*$") $afterPid.Trim()

# --- 汇总 ---
$total = $script:Results.Count
$fail = @($script:Results | Where-Object { -not $_.Pass }).Count
Write-Host "共 $total 项，失败 $fail 项"
Write-Host ""
Write-Host "=== 结果 ==="
$script:Results | Format-Table -AutoSize | Out-String -Width 200 | Write-Host

if ($fail -gt 0) {
  Write-Host "$fail 项失败"
  exit 1
}
Write-Host "全部通过，截图在 $OutDir"
exit 0

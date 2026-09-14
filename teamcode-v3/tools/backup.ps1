# =====================================================================
#  FGC2026 每晚備份腳本
#  用法： powershell -ExecutionPolicy Bypass -File tools\backup.ps1
#         powershell -ExecutionPolicy Bypass -File tools\backup.ps1 -NoZip
#         powershell -ExecutionPolicy Bypass -File tools\backup.ps1 -Serial 192.168.43.1:5555
#
#  會把 Control Hub 上這些東西整包抓回電腦：
#      /sdcard/FIRST/java/src          OnBotJava 的原始碼（最重要）
#      /sdcard/FIRST/settings          Driver Hub 硬體組態 XML
#      /sdcard/FIRST/ExternalLibraries 上傳的官方 jar / aar
#      /sdcard/FIRST/blocks            Blockly 程式（有用到才會有）
#      /sdcard/FIRST/fgc-rec           儀表板錄影 .jsonl
#      /sdcard/FIRST/fgc-tune.json     線上調參存檔
#
#  存到  %USERPROFILE%\Desktop\FGC2026\backup\<yyyyMMdd-HHmmss>\  並壓成同名 .zip
#
#  注意：本檔是 Windows PowerShell 5.1 語法 —— 不可以用 && 、?: 、??
# =====================================================================

param(
    [string]$Serial = "",
    [switch]$NoZip
)

$ErrorActionPreference = 'Continue'

# ── 1. 找 adb ────────────────────────────────────────────────────────
$adb = $null
$cmd = Get-Command adb -ErrorAction SilentlyContinue
if ($null -ne $cmd) { $adb = $cmd.Source }

if ($null -eq $adb) {
    $cand = @(
        "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
        "$env:USERPROFILE\AppData\Local\Android\Sdk\platform-tools\adb.exe",
        "C:\platform-tools\adb.exe",
        "$env:USERPROFILE\Desktop\platform-tools\adb.exe",
        "C:\Program Files\Android\platform-tools\adb.exe"
    )
    foreach ($c in $cand) {
        if (Test-Path $c) { $adb = $c; break }
    }
}

if ($null -eq $adb) {
    Write-Host "ERROR: 找不到 adb.exe。"
    Write-Host "  請下載 Android SDK Platform Tools，解壓後把資料夾加進 PATH，"
    Write-Host "  或直接放到 $env:USERPROFILE\Desktop\platform-tools\ 再重跑。"
    exit 2
}

Write-Host "adb  : $adb"
& $adb version | Select-Object -First 2 | ForEach-Object { Write-Host "       $_" }

# ── 2. 確認有裝置；沒有就試著用 Wi-Fi 連 Control Hub ────────────────
$devArgs = @()
if ($Serial -ne "") { $devArgs = @("-s", $Serial) }

$devList = & $adb devices
$online = $devList | Select-String -Pattern "\sdevice$"
if ($null -eq $online) {
    Write-Host "沒有已連線的裝置，嘗試 adb connect 192.168.43.1:5555 ..."
    & $adb connect 192.168.43.1:5555 | ForEach-Object { Write-Host "       $_" }
    Start-Sleep -Milliseconds 800
    $devList = & $adb devices
    $online = $devList | Select-String -Pattern "\sdevice$"
}
if ($null -eq $online) {
    Write-Host "ERROR: 還是沒有裝置。請確認："
    Write-Host "  - 電腦已連上 Control Hub 的 Wi-Fi（SSID 通常是隊伍名稱）"
    Write-Host "  - 或改用 USB 線接 Control Hub 的 USB-C"
    & $adb devices | ForEach-Object { Write-Host "       $_" }
    exit 3
}
Write-Host "裝置 :"
$devList | Where-Object { $_ -ne "" } | ForEach-Object { Write-Host "       $_" }

# ── 3. RC app 版本 ───────────────────────────────────────────────────
$pkg = "com.qualcomm.ftcrobotcontroller"
$dump = & $adb @devArgs shell "dumpsys package $pkg | grep versionName"
$rcVer = "(unknown)"
if ($null -ne $dump) {
    $line = ($dump | Select-String -Pattern "versionName" | Select-Object -First 1)
    if ($null -ne $line) { $rcVer = ($line.ToString()).Trim() }
}
Write-Host "RC app: $pkg  $rcVer"

$osVer = & $adb @devArgs shell "getprop ro.build.display.id"
if ($null -ne $osVer) { Write-Host "Hub OS: $($osVer -join ' ')" }

# ── 4. 建立目的地資料夾 ──────────────────────────────────────────────
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$root  = Join-Path $env:USERPROFILE "Desktop\FGC2026\backup"
$dest  = Join-Path $root $stamp
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Write-Host ""
Write-Host "備份到: $dest"
Write-Host ""

# ── 5. 逐項 pull ─────────────────────────────────────────────────────
$items = @(
    "/sdcard/FIRST/java/src",
    "/sdcard/FIRST/FGC2026.xml",         # 硬體組態（RC 11.x 放在 /sdcard/FIRST/<組態名>.xml）
    "/sdcard/FIRST/ExternalLibraries",
    "/sdcard/FIRST/blocks",
    "/sdcard/FIRST/fgc-rec",
    "/sdcard/FIRST/matchlogs",           # RC app 每場的 log，查問題用
    "/sdcard/FIRST/fgc-tune.json"
)

$okCount   = 0
$missCount = 0
foreach ($src in $items) {
    $out = & $adb @devArgs pull $src $dest
    if ($LASTEXITCODE -eq 0) {
        Write-Host ("  OK   {0}" -f $src)
        $okCount = $okCount + 1
    } else {
        Write-Host ("  MISS {0}   (裝置上沒有這個路徑，通常正常)" -f $src)
        $missCount = $missCount + 1
    }
}

# 順手記一份環境資訊，之後查問題用得到
$meta = @()
$meta += "backup   : $stamp"
$meta += "adb      : $adb"
$meta += "device   : " + (($devList | Where-Object { $_ -match "device$" }) -join "; ")
$meta += "rc app   : $pkg $rcVer"
$meta += "hub os   : " + ($osVer -join ' ')
$meta += "pulled ok: $okCount   missing: $missCount"
$meta | Out-File -FilePath (Join-Path $dest "backup-info.txt") -Encoding utf8

# ── 6. 統計 + 壓縮 ───────────────────────────────────────────────────
$files = Get-ChildItem -Recurse -File $dest
$bytes = ($files | Measure-Object -Property Length -Sum).Sum
if ($null -eq $bytes) { $bytes = 0 }
Write-Host ""
Write-Host ("檔案 : {0} 個, {1:N1} MB" -f $files.Count, ($bytes / 1MB))

if ($NoZip) {
    Write-Host "略過壓縮 (-NoZip)"
} else {
    $zip = "$dest.zip"
    try {
        Compress-Archive -Path (Join-Path $dest '*') -DestinationPath $zip -Force -ErrorAction Stop
        $zi = Get-Item $zip
        Write-Host ("ZIP  : {0}  ({1:N1} MB)" -f $zip, ($zi.Length / 1MB))
    } catch {
        Write-Host "WARN : 壓縮失敗 - $($_.Exception.Message)"
        Write-Host "       資料夾本身已經備份好了，可以手動壓。"
    }
}

Write-Host ""
Write-Host "DONE"
exit 0

# FGC2026 teamcode-v3 編譯檢查
# 用法： powershell -ExecutionPolicy Bypass -File tools\check.ps1
# EXIT 必須是 0 才算通過。
$ErrorActionPreference = 'Continue'

$Jdk  = 'C:\Users\feihong\Desktop\jdk-23.0.1'
$Sdk  = 'C:\Users\feihong\Desktop\FtcRobotController-master\TeamCode\build\intermediates\assets\debug\mergeDebugAssets\java'
$Src  = 'C:\Users\feihong\Desktop\FGC2026\teamcode-v3'
$Out  = Join-Path $Src 'out'

$javac   = Join-Path $Jdk 'bin\javac.exe'
$android = Join-Path $Sdk 'android.jar'
$onbot   = Join-Path $Sdk 'onbotjava-classes.jar'

foreach ($p in @($javac, $android, $onbot, $Src)) {
    if (-not (Test-Path $p)) { Write-Host "MISSING: $p"; exit 2 }
}

if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }
New-Item -ItemType Directory -Force -Path $Out | Out-Null

$files = Get-ChildItem -Recurse -Filter *.java $Src | Where-Object { $_.FullName -notmatch '\\(backup|tools|out)\\' } | ForEach-Object { $_.FullName }
Write-Host ("compiling {0} files" -f $files.Count)

& $javac -source 8 -target 8 -encoding UTF-8 -Xlint:-options `
    -bootclasspath $android `
    -cp "$onbot;$android" `
    -d $Out $files

$code = $LASTEXITCODE
Write-Host "EXIT $code"
if ($code -eq 0) {
    $n = (Get-ChildItem -Recurse -Filter *.class $Out | Measure-Object).Count
    Write-Host "OK - $n class files"
}
exit $code

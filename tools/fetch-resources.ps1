# Kew for Windows — fetch the bundled engines into resources\
# (yt-dlp.exe + ffmpeg.exe). Cybergah Group.
# Run:  powershell -ExecutionPolicy Bypass -File tools\fetch-resources.ps1
$ErrorActionPreference = "Stop"
$res = Join-Path $PSScriptRoot "..\resources"
New-Item -ItemType Directory -Force $res | Out-Null

# 1) yt-dlp.exe (latest)
$yt = Join-Path $res "yt-dlp.exe"
Write-Host "yt-dlp.exe indiriliyor..."
Invoke-WebRequest "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile $yt
Write-Host ("  OK  {0:N1} MB" -f ((Get-Item $yt).Length/1MB))

# 2) ffmpeg.exe (essentials build)
$ff = Join-Path $res "ffmpeg.exe"
if (Test-Path $ff) {
  Write-Host "ffmpeg.exe zaten var."
} else {
  $zip = Join-Path $env:TEMP "ffmpeg-ess.zip"
  Write-Host "ffmpeg indiriliyor (essentials)..."
  Invoke-WebRequest "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $zip
  $tmp = Join-Path $env:TEMP "ffmpeg-ess"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive $zip $tmp -Force
  $src = Get-ChildItem $tmp -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
  Copy-Item $src.FullName $ff -Force
  Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host ("  OK  {0:N1} MB" -f ((Get-Item $ff).Length/1MB))
}

Write-Host "Hazir. Simdi: npm install ; npm start"

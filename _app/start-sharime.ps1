# start-sharime.ps1 — start the Sharime server (hidden) if needed, then open it in
# a clean Chrome app window. Invoked by Sharime.vbs so no console window appears.

$ErrorActionPreference = 'SilentlyContinue'
$port = 4188
$root = Split-Path -Parent $PSScriptRoot          # ...\projects\sharime
$server = Join-Path $root 'server.mjs'
$url = "http://127.0.0.1:$port"

# Resolve node (prefer the standard install; fall back to PATH).
$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $node) { $node = 'node' }

# Start the server only if the port isn't already listening.
$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Start-Process -FilePath $node -ArgumentList "`"$server`"" -WorkingDirectory $root -WindowStyle Hidden
  for ($i = 0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 250
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { break }
  }
}

# Open in a dedicated Chrome app window if Chrome is present, else the default browser.
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($chrome) {
  $profileDir = Join-Path $env:LOCALAPPDATA 'Sharimie\chrome'
  Start-Process $chrome -ArgumentList "--app=$url", "--user-data-dir=`"$profileDir`""
} else {
  Start-Process $url
}

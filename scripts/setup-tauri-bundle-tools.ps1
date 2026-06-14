# Pre-download Tauri Windows bundler tools when `tauri build` fails with
# `timeout: global` while fetching from GitHub.
$ErrorActionPreference = "Stop"

$toolsRoot = Join-Path $env:LOCALAPPDATA "tauri"
$nsisRoot = Join-Path $toolsRoot "NSIS"
$pluginsDir = Join-Path $nsisRoot "Plugins\x86-unicode"
$tempDir = Join-Path $env:TEMP "xcoder-tauri-tools"

New-Item -ItemType Directory -Force -Path $toolsRoot, $nsisRoot, $pluginsDir, $tempDir | Out-Null

function Download-File($Url, $OutFile) {
    Write-Host "Downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -TimeoutSec 120
}

$nsisZip = Join-Path $tempDir "nsis-3.11.zip"
Download-File "https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip" $nsisZip
Expand-Archive -Path $nsisZip -DestinationPath $tempDir -Force

$extracted = Join-Path $tempDir "nsis-3.11"
if (-not (Test-Path $extracted)) {
    throw "Unexpected NSIS archive layout: missing nsis-3.11 folder"
}

Get-ChildItem $extracted | ForEach-Object {
    $target = Join-Path $nsisRoot $_.Name
    if (Test-Path $target) {
        Remove-Item $target -Recurse -Force
    }
    Move-Item $_.FullName $target
}

$appIdZip = Join-Path $tempDir "NSIS-ApplicationID.zip"
Download-File "https://github.com/tauri-apps/binary-releases/releases/download/nsis-plugins-v0/NSIS-ApplicationID.zip" $appIdZip
Expand-Archive -Path $appIdZip -DestinationPath (Join-Path $tempDir "NSIS-ApplicationID") -Force
Copy-Item (Join-Path $tempDir "NSIS-ApplicationID\Release\*") $pluginsDir -Force

$utilsDll = Join-Path $tempDir "nsis_tauri_utils.dll"
Download-File "https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll" $utilsDll
Copy-Item $utilsDll (Join-Path $pluginsDir "nsis_tauri_utils.dll") -Force

Write-Host ""
Write-Host "Tauri bundler tools installed to: $nsisRoot"
Write-Host "You can now run: npm run tauri build"

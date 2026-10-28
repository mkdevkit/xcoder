param(
  [string]$OutputDir = "dist-vscode"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$extensionDir = Join-Path $root "vscode-extension"
$outDir = Join-Path $root $OutputDir

Push-Location $root
try {
  Write-Host "Building VS Code webview..."
  npm run build:vscode
  if ($LASTEXITCODE -ne 0) { throw "vite build failed" }

  Write-Host "Compiling extension host..."
  npx tsc -p (Join-Path $extensionDir "tsconfig.json")
  if ($LASTEXITCODE -ne 0) { throw "tsc failed" }

  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $vsix = Join-Path $outDir "xcoder-vscode.vsix"

  Push-Location $extensionDir
  try {
    Write-Host "Packaging VSIX..."
    npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository --out $vsix
    if ($LASTEXITCODE -ne 0) { throw "vsce package failed" }
  } finally {
    Pop-Location
  }

  Write-Host "Created $vsix"
} finally {
  Pop-Location
}

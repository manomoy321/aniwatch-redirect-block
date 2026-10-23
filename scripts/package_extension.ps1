# FocusGuard Extension Packaging Script (PowerShell)
# Bundles only clean production assets into a distributable zip archive.

$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $rootDir "manifest.json"

if (!(Test-Path $manifestPath)) {
    Write-Error "manifest.json not found in $rootDir"
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version
$distDir = Join-Path $rootDir "dist"
$buildDir = Join-Path $distDir "build"
$zipName = "focusguard-aniwatch-downloader-v$version.zip"
$zipPath = Join-Path $distDir $zipName

Write-Host "Creating FocusGuard v$version distributable package..." -ForegroundColor Cyan

# Ensure clean dist directory
if (Test-Path $buildDir) {
    Remove-Item -Recurse -Force $buildDir
}
if (Test-Path $zipPath) {
    Remove-Item -Force $zipPath
}
New-Item -ItemType Directory -Path $buildDir -Force | Out-Null

# Production files & folders to include
$includeFiles = @(
    "manifest.json",
    "background.js",
    "content.js",
    "content.css",
    "inject.js",
    "player_controller.js",
    "player_hud.css"
)

$includeDirs = @(
    "icons",
    "popup"
)

foreach ($file in $includeFiles) {
    $src = Join-Path $rootDir $file
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $buildDir -Force
        Write-Host "  + Included file: $file" -ForegroundColor Gray
    } else {
        Write-Warning "Missing file: $file"
    }
}

foreach ($dir in $includeDirs) {
    $src = Join-Path $rootDir $dir
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination (Join-Path $buildDir $dir) -Recurse -Force
        Write-Host "  + Included directory: $dir" -ForegroundColor Gray
    } else {
        Write-Warning "Missing directory: $dir"
    }
}

# Compress into zip
Compress-Archive -Path "$buildDir\*" -DestinationPath $zipPath -Force
Remove-Item -Recurse -Force $buildDir

$zipSize = (Get-Item $zipPath).Length / 1KB
Write-Host "Package created successfully!" -ForegroundColor Green
Write-Host "Archive: $zipPath ($([Math]::Round($zipSize, 1)) KB)" -ForegroundColor Yellow

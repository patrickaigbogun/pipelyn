# install.ps1 — Pipelyn one-line installer for Windows
#
# Usage (PowerShell):
#   irm https://raw.githubusercontent.com/patrickaigbogun/pipelyn-distribution/main/install.ps1 | iex
#
# Environment overrides:
#   $env:PIPELYN_VERSION    — pin a specific release tag (e.g. v1.0.0); defaults to latest
#   $env:PIPELYN_INSTALL_DIR — where to install (default: $env:LOCALAPPDATA\pipelyn)
#   $env:PIPELYN_RELEASE_REPO — release repo to download from (default: patrickaigbogun/pipelyn)
#   $env:GITHUB_TOKEN        — optional token for private/internal release repos

[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = 'Stop'

$REPO        = if ($env:PIPELYN_RELEASE_REPO) { $env:PIPELYN_RELEASE_REPO } else { 'patrickaigbogun/pipelyn' }
$InstallDir  = if ($env:PIPELYN_INSTALL_DIR) { $env:PIPELYN_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'pipelyn' }

function Get-AuthHeaders {
    if ($env:GITHUB_TOKEN) {
        return @{
            Authorization = "Bearer $($env:GITHUB_TOKEN)"
            Accept        = 'application/vnd.github+json'
        }
    }
    return @{}
}

# ── Resolve version ────────────────────────────────────────────────────────
$version = $env:PIPELYN_VERSION
if (-not $version) {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/latest" -Headers (Get-AuthHeaders)
    $version = $release.tag_name
}

if (-not $version) {
    Write-Error 'Could not determine latest Pipelyn version. Set $env:PIPELYN_VERSION to pin one.'
    exit 1
}

$zipName = "pipelyn-$version-windows-x64.zip"
$baseUrl = "https://github.com/$REPO/releases/download/$version"

Write-Host ""
Write-Host "  Pipelyn $version for windows-x64"
Write-Host "  Installing to $InstallDir"
Write-Host ""

# ── Download ───────────────────────────────────────────────────────────────
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
    $zipPath = Join-Path $tmp $zipName
    Write-Host "Downloading $zipName ..."
    Invoke-WebRequest -Uri "$baseUrl/$zipName" -OutFile $zipPath -UseBasicParsing -Headers (Get-AuthHeaders)

    # ── Verify checksum ────────────────────────────────────────────────────
    Write-Host 'Verifying checksum ...'
    $checksumsPath = Join-Path $tmp 'SHA256SUMS'
    Invoke-WebRequest -Uri "$baseUrl/SHA256SUMS" -OutFile $checksumsPath -UseBasicParsing -Headers (Get-AuthHeaders)

    $expected = (Get-Content $checksumsPath | Where-Object { $_ -match [regex]::Escape($zipName) }) -replace '\s+.*', ''
    $actual   = (Get-FileHash -Algorithm SHA256 -Path $zipPath).Hash.ToLower()
    if ($expected -and $expected -ne $actual) {
        Write-Error "Checksum mismatch!`n  Expected: $expected`n  Got:      $actual"
        exit 1
    }

    # ── Extract ────────────────────────────────────────────────────────────
    Write-Host 'Extracting ...'
    Expand-Archive -Path $zipPath -DestinationPath $tmp -Force
    $extracted = Join-Path $tmp "pipelyn-$version-windows-x64"

    # ── Install ────────────────────────────────────────────────────────────
    if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Copy-Item -Path "$extracted\*" -Destination $InstallDir -Recurse -Force

    # ── Add to user PATH ───────────────────────────────────────────────────
    $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
    if ($userPath -notlike "*$InstallDir*") {
        [Environment]::SetEnvironmentVariable('PATH', "$userPath;$InstallDir", 'User')
        Write-Host "  Added $InstallDir to PATH"
    }

    Write-Host ""
    Write-Host "  Pipelyn $version installed successfully!"
    Write-Host ""
    Write-Host "  Restart your terminal, then run:  pipelyn"
    Write-Host ""
}
finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

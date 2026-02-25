# Build MSVC env (ARM64 native or x64 on ARM64) and run pnpm tauri dev.
$projectDir = (Get-Location).Path

$msvcBase = "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Tools\MSVC"
$msvcVer = Get-ChildItem $msvcBase -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if (-not $msvcVer) {
    Write-Host "MSVC not found under $msvcBase"
    exit 1
}
$msvcRoot = Join-Path $msvcBase $msvcVer.Name

# Prefer ARM64 native; fall back to x64 (runs under emulation on ARM64)
$binArm64 = Join-Path $msvcRoot "bin\Hostarm64\arm64"
$binX64 = Join-Path $msvcRoot "bin\Hostarm64\x64"
$libArm64 = Join-Path $msvcRoot "lib\arm64"
$libX64 = Join-Path $msvcRoot "lib\x64"

if (Test-Path (Join-Path $binArm64 "link.exe")) {
    $binDir = $binArm64
    $arch = "arm64"
    $libMsvc = $libArm64
} elseif (Test-Path (Join-Path $binX64 "link.exe")) {
    $binDir = $binX64
    $arch = "x64"
    $libMsvc = $libX64
    Write-Host "Using x64 toolchain (emulated on ARM64). For native ARM64, install 'C++ ARM64/ARM64EC build tools' in VS Installer."
} else {
    Write-Host "No link.exe found. Tried: $binArm64 and $binX64"
    exit 1
}

# Windows SDK libs (um + ucrt) for same arch
$sdkUm = "um\$arch"
$sdkUcrt = "ucrt\$arch"
$kitsRoots = @(
    "C:\Program Files (x86)\Windows Kits\10\Lib",
    "C:\Program Files\Windows Kits\10\Lib"
)
$libUm = $null
$libUcrt = $null
foreach ($kitsRoot in $kitsRoots) {
    if (-not (Test-Path $kitsRoot)) { continue }
    $sdkVer = Get-ChildItem $kitsRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "^\d+\.\d+" } | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $sdkVer) { continue }
    $sdkLib = Join-Path $kitsRoot $sdkVer.Name
    $um = Join-Path $sdkLib $sdkUm
    $ucrt = Join-Path $sdkLib $sdkUcrt
    if ((Test-Path $um) -and (Test-Path (Join-Path $um "kernel32.lib"))) {
        $libUm = $um
        $libUcrt = $ucrt
        break
    }
}
if (-not $libUm) {
    Write-Host "kernel32.lib not found for $arch. Expected: ...\Lib\<ver>\um\$arch and \ucrt\$arch"
    exit 1
}

$libPaths = @($libMsvc, $libUm, $libUcrt) | Where-Object { $_ -and (Test-Path $_) }
$libStr = $libPaths -join ";"
$libEsc = $libStr -replace '"', '""'

# Find NASM (needed by rav1e): check fixed paths first, then PATH, then search
$nasmDir = $null
foreach ($d in @(
    (Join-Path $env:LOCALAPPDATA "bin\NASM"),
    "C:\Program Files\NASM", "C:\Program Files (x86)\NASM", "C:\NASM",
    (Join-Path $env:LOCALAPPDATA "Programs\NASM"))) {
    if ($d -and (Test-Path (Join-Path $d "nasm.exe"))) { $nasmDir = $d; break }
}
if (-not $nasmDir) {
    foreach ($p in ($env:Path -split ";")) {
        $p = $p.Trim(); if ($p -and (Test-Path (Join-Path $p "nasm.exe"))) { $nasmDir = $p; break }
    }
}
if (-not $nasmDir) {
    $searchRoots = @("C:\Program Files", "C:\Program Files (x86)") + @(
        (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"),
        (Join-Path $env:LOCALAPPDATA "Programs")
    )
    foreach ($root in $searchRoots) {
        if (-not (Test-Path $root)) { continue }
        $nasmExe = Get-ChildItem -Path $root -Recurse -Filter "nasm.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($nasmExe) { $nasmDir = $nasmExe.DirectoryName; break }
    }
}
$pathPrefix = $binDir
if ($nasmDir) {
    $pathPrefix = "$binDir;$nasmDir"
    Write-Host "NASM found: $nasmDir"
} else {
    Write-Host "NASM not found in common paths. If rav1e fails, add NASM folder to PATH."
}

$cmdContent = @"
@echo off
set "LIB=$libEsc"
set "PATH=$pathPrefix;%PATH%"
cd /d "$projectDir"
call pnpm tauri dev
"@
$cmdFile = Join-Path $projectDir "tauri-dev-run.cmd"
$cmdContent | Out-File -FilePath $cmdFile -Encoding ASCII
Write-Host "Arch: $arch | PATH (first): $binDir | LIB: $($libPaths -join '; ')"
& cmd /c $cmdFile

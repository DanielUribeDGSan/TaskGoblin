# Build MSVC env (ARM64 native or x64 on ARM64) and run pnpm tauri dev.
$projectDir = (Get-Location).Path

$isArm64 = ($env:PROCESSOR_ARCHITECTURE -eq "ARM64")

# Search all Visual Studio installations (BuildTools, Community, Professional, etc.)
$vsBases = @(
    "C:\Program Files (x86)\Microsoft Visual Studio",
    "C:\Program Files\Microsoft Visual Studio"
)
$msvcRoot = $null
$binDir = $null
$libMsvc = $null
$arch = $null
$tempRustToolchain = $false

# 1) Try vswhere to find an installation that has ARM64 tools (most reliable)
if ($isArm64) {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $installPath = & $vswhere -latest -requires Microsoft.VisualStudio.Component.VC.Tools.ARM64 -property installationPath -products * 2>$null
        if ($installPath) {
            $msvcBase = Join-Path $installPath "VC\Tools\MSVC"
            if (Test-Path $msvcBase) {
                $msvcVer = Get-ChildItem $msvcBase -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
                if ($msvcVer) {
                    $root = Join-Path $msvcBase $msvcVer.Name
                    $binArm64 = Join-Path $root "bin\Hostarm64\arm64"
                    if (Test-Path (Join-Path $binArm64 "link.exe")) {
                        $msvcRoot = $root
                        $binDir = $binArm64
                        $arch = "arm64"
                        $libMsvc = Join-Path $root "lib\arm64"
                    }
                }
            }
        }
    }
}

# 2) Fallback: scan folders. Structure is VS\18\BuildTools\VC\Tools\MSVC or VS\2022\Community\VC\Tools\MSVC
$foundX64 = $null
if (-not $binDir) {
    foreach ($vsBase in $vsBases) {
        if (-not (Test-Path $vsBase)) { continue }
        $editions = Get-ChildItem $vsBase -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch "Installer" }
        foreach ($ed in $editions) {
            $subs = Get-ChildItem $ed.FullName -Directory -ErrorAction SilentlyContinue
            foreach ($sub in $subs) {
                $msvcBase = Join-Path $sub.FullName "VC\Tools\MSVC"
                if (-not (Test-Path $msvcBase)) { continue }
                $msvcVer = Get-ChildItem $msvcBase -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
                if (-not $msvcVer) { continue }
                $root = Join-Path $msvcBase $msvcVer.Name
                $binArm64 = Join-Path $root "bin\Hostarm64\arm64"
                $binX64 = Join-Path $root "bin\Hostarm64\x64"
                $libArm64 = Join-Path $root "lib\arm64"
                $libX64 = Join-Path $root "lib\x64"
                if (Test-Path (Join-Path $binArm64 "link.exe")) {
                    $msvcRoot = $root
                    $binDir = $binArm64
                    $arch = "arm64"
                    $libMsvc = $libArm64
                    break
                }
                if (Test-Path (Join-Path $binX64 "link.exe")) {
                    $foundX64 = @{ binDir = $binX64; libMsvc = $libX64; root = $root }
                }
                if (-not $isArm64 -and $foundX64) {
                    $binDir = $foundX64.binDir
                    $arch = "x64"
                    $libMsvc = $foundX64.libMsvc
                    $msvcRoot = $foundX64.root
                    break
                }
            }
            if ($binDir) { break }
        }
        if ($binDir) { break }
    }
}

# 3) On ARM64 with no ARM64 linker: use x64 (emulated). Force Rust to use x86_64 toolchain.
$tempRustToolchain = $false
if (-not $binDir -and $isArm64 -and $foundX64) {
    $binDir = $foundX64.binDir
    $arch = "x64"
    $libMsvc = $foundX64.libMsvc
    $msvcRoot = $foundX64.root
    Write-Host "Using x64 tools (ARM64 linker not installed). Forcing Rust x86_64 toolchain..."
    & rustup toolchain install stable-x86_64-pc-windows-msvc --force-non-host 2>$null
    & rustup override set stable-x86_64-pc-windows-msvc
    # rust-toolchain.toml with "channel = stable" overrides the override on ARM64 (resolves to aarch64). Temporarily use x86_64.
    $rtRoot = Join-Path $projectDir "rust-toolchain.toml"
    $rtTauri = Join-Path $projectDir "src-tauri\rust-toolchain.toml"
    foreach ($f in @($rtRoot, $rtTauri)) {
        $bak = "$f.bak"
        if (Test-Path $bak) { Remove-Item $bak -Force }
        if (Test-Path $f) {
            Rename-Item $f $bak -Force
            Set-Content $f -Value '[toolchain]', 'channel = "stable-x86_64-pc-windows-msvc"' -Encoding UTF8
            $tempRustToolchain = $true
        }
    }
    Write-Host ""
}

if (-not $binDir) {
    if ($isArm64) {
        Write-Host ""
        Write-Host "ERROR: No ARM64 linker and no x64 linker found."
        Write-Host "Install 'Desktop development with C++' with at least x64 or ARM64 build tools."
        Write-Host ""
        exit 1
    }
    Write-Host "No link.exe found under Visual Studio."
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
try {
    & cmd /c $cmdFile
} finally {
    if ($tempRustToolchain) {
        foreach ($f in @(
            (Join-Path $projectDir "rust-toolchain.toml"),
            (Join-Path $projectDir "src-tauri\rust-toolchain.toml")
        )) {
            $bak = "$f.bak"
            if (Test-Path $bak) {
                if (Test-Path $f) { Remove-Item $f -Force }
                Rename-Item $bak $f -Force
            }
        }
    }
}

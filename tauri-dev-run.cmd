@echo off
set "LIB=C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Tools\MSVC\14.50.35717\lib\x64;C:\Program Files (x86)\Windows Kits\10\Lib\10.0.26100.0\um\x64;C:\Program Files (x86)\Windows Kits\10\Lib\10.0.26100.0\ucrt\x64"
set "PATH=C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Tools\MSVC\14.50.35717\bin\Hostarm64\x64;C:\Users\kskroyal\AppData\Local\bin\NASM;%PATH%"
cd /d "C:\Users\kskroyal\Desktop\projects\TaskGoblin"
call pnpm tauri dev

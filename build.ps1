# LAN ChatRoom build script
# Usage: .\build.ps1 [server|client|all|server-setup]

param([string]$Target = "all")

$Root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$Dist = "$Root\dist"

Write-Host "=== installing deps ===" -ForegroundColor Cyan
Set-Location $Root
npm install

function Build-Server {
    Write-Host "=== building server portable ===" -ForegroundColor Cyan
    $OutDir = "$Dist\server"
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
    New-Item -ItemType Directory -Path "$OutDir\uploads" -Force | Out-Null
    Copy-Item "C:\Program Files\nodejs\node.exe" -Destination "$OutDir\node.exe"
    $files = @('server.js','adminConsole.js','config.json','package.json','index.html','script.js','style.css','game.html','game.js','gomoku.js','tictactoe.js','rps.js','connect4.js','othello.js','guess.js','battleship.js')
    foreach ($f in $files) { Copy-Item "$Root\$f" -Destination "$OutDir\$f" }
    Copy-Item -Recurse "$Root\games" -Destination "$OutDir\games"
    Copy-Item -Recurse "$Root\node_modules" -Destination "$OutDir\node_modules"
$startBat = @"
@echo off
title LAN ChatRoom - Server
echo ========================================
echo   LAN ChatRoom Server
echo ========================================
echo.
"%%~dp0node.exe" "%%~dp0server.js"
pause
"@
    $startBat | Out-File -FilePath "$OutDir\start.bat" -Encoding ASCII
    $size = (Get-ChildItem $OutDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
    Write-Host "OK server portable at $OutDir (${size:N1} MB)" -ForegroundColor Green
}

function Build-Client {
    Write-Host "=== client already built via electron ===" -ForegroundColor Yellow
}

function Build-ServerSetup {
    Write-Host "=== building server installer ===" -ForegroundColor Cyan
    $Staging = "$Root\server-app\staging"
    if (Test-Path $Staging) { Remove-Item $Staging -Recurse -Force }
    New-Item -ItemType Directory -Path $Staging -Force | Out-Null
    New-Item -ItemType Directory -Path "$Staging\uploads" -Force | Out-Null

    # Electron renderer (log console)
    Copy-Item "$Root\server-app\main.js"       "$Staging\main.js"
    Copy-Item "$Root\server-app\console.html"  "$Staging\console.html"
    Copy-Item "$Root\server-app\preload.js"    "$Staging\preload.js"

    # Server & web files
    Copy-Item "$Root\server.js"             "$Staging\server.js"
    Copy-Item "$Root\adminConsole.js"       "$Staging\adminConsole.js"
    Copy-Item "$Root\config.json"           "$Staging\config.json"
    Copy-Item "$Root\index.html"            "$Staging\index.html"
    Copy-Item "$Root\game.html"             "$Staging\game.html"
    Copy-Item "$Root\script.js"             "$Staging\script.js"
    Copy-Item "$Root\style.css"             "$Staging\style.css"
    Copy-Item "$Root\game.js"               "$Staging\game.js"
    Copy-Item "$Root\*.js"                  "$Staging"
    Copy-Item -Recurse "$Root\games"        "$Staging\games"

    $exclude = @('electron','electron-builder','.bin','sqlite3')
    Get-ChildItem "$Root\node_modules" -Directory | Where-Object { $_.Name -notin $exclude } | ForEach-Object {
        $d = "$Staging\node_modules\$($_.Name)"
        if (Test-Path $d) { Remove-Item $d -Recurse -Force }
        Copy-Item -Recurse $_.FullName $d
    }

    $rootPkg = Get-Content "$Root\package.json" -Raw -Encoding UTF8 | ConvertFrom-Json
    $deps = $rootPkg.dependencies
    $eV = (Get-Content "$Root\client\node_modules\electron\dist\version" -Raw).Trim()
    $ed = $Root.Replace('\','\\') + '\\client\\node_modules\\electron\\dist'
    $od = $Root.Replace('\','\\') + '\\dist\\server-setup'

    $depsFiltered = [PSCustomObject]@{}
    $deps.PSObject.Properties | Where-Object { $_.Name -ne 'sqlite3' } | ForEach-Object {
        $depsFiltered | Add-Member -MemberType NoteProperty -Name $_.Name -Value $_.Value
    }

    $pkg = [PSCustomObject]@{
        name = "lan-chat-server"
        version = "1.1.0"
        description = "LAN ChatRoom server desktop app"
        main = "main.js"
        build = [PSCustomObject]@{
            appId = "lan.chatroom.server"
            productName = "LAN Chat 服务器"
            directories = [PSCustomObject]@{ output = $od }
            electronDist = $ed
            electronVersion = $eV
            asar = $false
            win = [PSCustomObject]@{ target = "nsis" }
            nsis = [PSCustomObject]@{
                oneClick = $false
                allowToChangeInstallationDirectory = $true
                createDesktopShortcut = $true
                shortcutName = "LAN Chat 服务器"
                language = "2052"
            }
        }
        dependencies = $depsFiltered
    }
    $json = $pkg | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText("$Staging\package.json", $json)

    $env:NODE_TLS_REJECT_UNAUTHORIZED = '0'
    Push-Location $Staging
    & "$Root\client\node_modules\.bin\electron-builder.cmd" --win --x64
    Pop-Location

    if ($?) { Write-Host "OK server installer at $Dist\server-setup" -ForegroundColor Green }
    else    { Write-Host "FAILED server installer build" -ForegroundColor Red }
}

switch ($Target.ToLower()) {
    "server"       { Build-Server }
    "client"       { Build-Client }
    "server-setup" { Build-ServerSetup }
    default        { Build-Server; Build-Client }
}

Set-Location $Root
Write-Host "=== build complete ===" -ForegroundColor Green
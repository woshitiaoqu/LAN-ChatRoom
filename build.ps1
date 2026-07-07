# LAN ChatRoom 打包脚本
# 用法: .\build.ps1 [server|client|all]

param([string]$Target = "all")

$Root = Split-Path -Parent $MyInvocation.MyCommand.Definition

# 安装根目录依赖
Write-Host "=== 安装服务端依赖 ===" -ForegroundColor Cyan
Set-Location $Root
npm install

if ($Target -eq "server" -or $Target -eq "all") {
    Write-Host "=== 打包服务端 ===" -ForegroundColor Cyan
    # 确保 pkg 已安装
    $pkg = Get-Command "pkg" -ErrorAction SilentlyContinue
    if (-not $pkg) {
        Write-Host "安装 pkg..." -ForegroundColor Yellow
        npm install -g pkg
    }
    New-Item -ItemType Directory -Path "$Root\dist" -Force | Out-Null
    pkg server.js --targets node18-win-x64 --output "$Root\dist\LANChat-Server.exe"
    Copy-Item -Path "$Root\config.json" -Destination "$Root\dist\config.json" -Force
    Write-Host "✅ 服务端已打包到 dist\LANChat-Server.exe" -ForegroundColor Green
}

if ($Target -eq "client" -or $Target -eq "all") {
    Write-Host "=== 打包客户端 ===" -ForegroundColor Cyan
    Set-Location "$Root\client"
    npm install
    npm run build
    Write-Host "✅ 客户端安装包已生成到 client\dist" -ForegroundColor Green
}

Set-Location $Root
Write-Host "=== 打包完成 ===" -ForegroundColor Green
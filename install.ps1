# 安装 skills\ 下全部 skill 到 $CODEX_HOME\skills（默认 ~/.codex）
# 每个 skill 镜像覆盖安装（robocopy /MIR），互不影响。
# 用法: powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = 'Stop'

$src = $PSScriptRoot
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
$dest = Join-Path $codexHome 'skills'
$skillsDir = Join-Path $src 'skills'

@('tech-workflow', 'tech-visual-companion') | ForEach-Object {
    $legacyDir = Join-Path $dest $_
    if (Test-Path $legacyDir) {
        Remove-Item -Recurse -Force $legacyDir
    }
}

$count = 0
Get-ChildItem -Directory $skillsDir | ForEach-Object {
    if (-not (Test-Path (Join-Path $_.FullName 'SKILL.md'))) { return }
    $skillDest = Join-Path $dest $_.Name
    New-Item -ItemType Directory -Force -Path $skillDest | Out-Null
    # /MIR 等价 rsync -a --delete；robocopy 退出码 < 8 视为成功
    robocopy $_.FullName $skillDest /MIR /XF .DS_Store /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "robocopy failed for $($_.Name) with exit code $LASTEXITCODE"
    }
    $count++
}

Write-Output "installed: $count skills → $dest (v1.18.0)"

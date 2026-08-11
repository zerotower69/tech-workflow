# 安装 tech-tower-workflow skill 到 $CODEX_HOME\skills（默认 ~/.codex）
# 用法: powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = 'Stop'

$src = $PSScriptRoot
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
$dest = Join-Path $codexHome 'skills\tech-tower-workflow'

New-Item -ItemType Directory -Force -Path $dest | Out-Null

# /MIR 等价 rsync -a --delete；/XD 排除 .git 与 node_modules
# robocopy 退出码 < 8 视为成功
robocopy $src $dest /MIR /XD .git node_modules claude-plugin .claude-plugin /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
foreach ($d in @('claude-plugin','.claude-plugin')) {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $dest $d)
}
if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed with exit code $LASTEXITCODE"
}

Write-Output "installed: $dest (v1.5.0)"

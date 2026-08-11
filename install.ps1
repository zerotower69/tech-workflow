# 安装 tech-tower-workflow skill 到 $CODEX_HOME\skills（默认 ~/.codex）
# 用法: powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = 'Stop'

$src = $PSScriptRoot
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
$dest = Join-Path $codexHome 'skills\tech-tower-workflow'

New-Item -ItemType Directory -Force -Path $dest | Out-Null

# /MIR 等价 rsync -a --delete；/XD 排除目录、/XF 排除文件（与 install.sh / bin 安装器对齐）
# robocopy 退出码 < 8 视为成功
robocopy $src $dest /MIR /XD .git node_modules claude-plugin .claude-plugin plugin-src archive bin /XF package.json .version-bump.json .npmrc /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
# /XD、/XF 被排除的项不会从目标端清理旧残留，这里补一刀
foreach ($d in @('claude-plugin','.claude-plugin','plugin-src','archive','bin')) {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $dest $d)
}
foreach ($f in @('package.json','.version-bump.json','.npmrc')) {
    Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $dest $f)
}
if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed with exit code $LASTEXITCODE"
}

Write-Output "installed: $dest (v1.8.0)"

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$temp = Join-Path ([IO.Path]::GetTempPath()) ('bili-progress-test-' + [Guid]::NewGuid().ToString('N'))
$resources = Join-Path $temp 'resources'
New-Item -ItemType Directory -Path $resources -Force | Out-Null

try {
    # 最小资源包包含安装入口和版本，足够检查补丁与恢复流程。
    $files = @{
        'index.js' = 'console.log("fixture");'
        'package.json' = '{"name":"bilibili","version":"1.17.2"}'
    }
    $header = @{ files = @{} }
    $chunks = @()
    $offset = 0
    foreach ($entry in $files.GetEnumerator()) {
        $bytes = [Text.Encoding]::UTF8.GetBytes($entry.Value)
        $header.files[$entry.Key] = @{ size = $bytes.Length; offset = [string]$offset }
        $chunks += ,$bytes
        $offset += $bytes.Length
    }
    $json = [Text.Encoding]::UTF8.GetBytes(($header | ConvertTo-Json -Depth 8 -Compress))
    $payload = (4 + $json.Length + 3) -band -4
    $path = Join-Path $resources 'app.asar'
    $writer = [IO.BinaryWriter]::new([IO.File]::Create($path))
    try {
        $writer.Write([int]4)
        $writer.Write([int](4 + $payload))
        $writer.Write([int]$payload)
        $writer.Write([int]$json.Length)
        $writer.Write($json)
        $writer.Write([byte[]]::new($payload - 4 - $json.Length))
        foreach ($bytes in $chunks) { $writer.Write([byte[]]$bytes) }
    } finally { $writer.Dispose() }

    $assembly = [Reflection.Assembly]::LoadFrom((Join-Path $root 'BiliProgressSetup.exe'))
    $installer = $assembly.GetType('BiliProgress.Installer')
    $flags = [Reflection.BindingFlags]'NonPublic,Static'
    $argsList = New-Object 'System.Object[]' 1
    $argsList[0] = [string]$temp
    $original = (Get-FileHash -LiteralPath $path).Hash

    $installer.GetMethod('Install', $flags).Invoke($null, $argsList)
    if (!(Test-Path -LiteralPath (Join-Path $resources 'app.asar.bpm-original'))) { throw '未创建备份' }
    if ((Get-FileHash -LiteralPath $path).Hash -eq $original) { throw '未写入插件' }

    $data = [IO.File]::ReadAllBytes($path)
    $size = [BitConverter]::ToInt32($data, 12)
    $patched = [Text.Encoding]::UTF8.GetString($data, 16, $size) | ConvertFrom-Json
    foreach ($name in @('bpm-main.js', 'bpm-core.js', 'bpm-client.js', 'bpm-extension.js')) {
        if (!$patched.files.PSObject.Properties[$name]) { throw "缺少模块：$name" }
    }

    $installer.GetMethod('Uninstall', $flags).Invoke($null, $argsList)
    if ((Get-FileHash -LiteralPath $path).Hash -ne $original) { throw '恢复后的文件与原文件不同' }
    Write-Output 'PASS: 安装、备份、模块写入、卸载恢复'
} finally {
    # temp 是本次测试新建的目录。
    if ([IO.Path]::GetFullPath($temp).StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $temp -Recurse -Force
    }
}

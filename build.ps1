$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw '需要 Windows .NET Framework 4.x 编译器。' }
$exe = Join-Path $projectDir 'BiliProgressSetup.exe'
$argsList = @(
    '/nologo', '/target:winexe', '/platform:anycpu', '/optimize+',
    "/out:$exe",
    '/reference:System.Windows.Forms.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Web.Extensions.dll'
)
foreach ($name in @('core.js', 'client.js', 'extension.js', 'main.js')) {
    $argsList += "/resource:$projectDir\src\$name,$name"
}
$argsList += (Get-ChildItem -LiteralPath "$projectDir\src" -Filter '*.cs').FullName
& $compiler @argsList
if ($LASTEXITCODE -ne 0) { throw '编译失败' }
Write-Output $exe

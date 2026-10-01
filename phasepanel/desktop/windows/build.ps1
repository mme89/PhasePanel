$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoDir = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$outputDir = Join-Path $repoDir 'dist/windows'
$bundleDir = Join-Path $outputDir 'PhasePanel'
$stagingDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
$nodeVersion = if ($env:NODE_VERSION) { $env:NODE_VERSION } else { '24.21.0' }
$runtimeName = "node-v$nodeVersion-win-x64"
$releaseUrl = "https://nodejs.org/dist/v$nodeVersion"

New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null
try {
    Set-Location $repoDir
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
    if (Test-Path $bundleDir) { Remove-Item -Recurse -Force $bundleDir }
    New-Item -ItemType Directory -Path (Join-Path $bundleDir 'app/dist') -Force | Out-Null
    Copy-Item -Recurse 'dist/client', 'dist/server', 'dist/shared' (Join-Path $bundleDir 'app/dist')
    Copy-Item 'package.json' (Join-Path $bundleDir 'app')
    Copy-Item 'LICENSE' $bundleDir
    Copy-Item 'package.json', 'package-lock.json' $stagingDir
    Push-Location $stagingDir
    try {
        npm ci --omit=dev --prefer-offline --no-audit
        if ($LASTEXITCODE -ne 0) { throw 'Production dependency install failed.' }
    } finally { Pop-Location }
    node 'desktop/prune-dependencies.mjs' (Join-Path $stagingDir 'node_modules')
    if ($LASTEXITCODE -ne 0) { throw 'Production dependency pruning failed.' }
    Copy-Item -Recurse (Join-Path $stagingDir 'node_modules') (Join-Path $bundleDir 'app')

    $archive = Join-Path $stagingDir "$runtimeName.zip"
    $checksums = Join-Path $stagingDir 'SHASUMS256.txt'
    Invoke-WebRequest "$releaseUrl/SHASUMS256.txt" -OutFile $checksums
    Invoke-WebRequest "$releaseUrl/$runtimeName.zip" -OutFile $archive
    $checksumLine = Get-Content $checksums | Where-Object { $_.EndsWith("  $runtimeName.zip") } | Select-Object -First 1
    if (-not $checksumLine) { throw 'Node.js archive checksum was not found.' }
    $expected = ($checksumLine -split '\s+')[0]
    $actual = (Get-FileHash $archive -Algorithm SHA256).Hash
    if ($actual -ine $expected) { throw 'Node.js archive checksum mismatch.' }
    Expand-Archive $archive $stagingDir
    Copy-Item (Join-Path $stagingDir "$runtimeName/node.exe") (Join-Path $bundleDir 'node.exe')
    Copy-Item (Join-Path $stagingDir "$runtimeName/LICENSE") (Join-Path $bundleDir 'NODE-LICENSE')

    $version = (Get-Content package.json | ConvertFrom-Json).version
    dotnet publish 'desktop/windows/PhasePanel.csproj' -c Release -r win-x64 --self-contained true `
        -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
        "-p:Version=$version" `
        -o (Join-Path $stagingDir 'publish')
    if ($LASTEXITCODE -ne 0) { throw 'Windows launcher build failed.' }
    Copy-Item (Join-Path $stagingDir 'publish/PhasePanel.exe') (Join-Path $bundleDir 'PhasePanel.exe')

    $releaseArchive = Join-Path $outputDir "PhasePanel-v$version-windows-x64.zip"
    if (Test-Path $releaseArchive) { Remove-Item -Force $releaseArchive }
    Compress-Archive -Path $bundleDir -DestinationPath $releaseArchive
    Write-Host "Built $releaseArchive"
} finally {
    Set-Location $repoDir
    Remove-Item -Recurse -Force $stagingDir -ErrorAction SilentlyContinue
}

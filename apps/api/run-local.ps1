$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$envFile = Join-Path $root '.env'
if (-not (Test-Path $envFile)) { throw 'Create the root .env file with RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.' }

foreach ($line in Get-Content $envFile) {
    if ($line.Trim() -eq '' -or $line.TrimStart().StartsWith('#')) { continue }
    $parts = $line.Split('=', 2)
    if ($parts.Length -ne 2) { throw 'Invalid .env entry. Expected NAME=value.' }
    [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), 'Process')
}

Push-Location (Join-Path $PSScriptRoot 'Eshopper.Api')
try {
    dotnet run @args
    if ($LASTEXITCODE -ne 0) { throw "API exited with code $LASTEXITCODE." }
}
finally { Pop-Location }

param(
    [Parameter(Mandatory = $true)]
    [string]$Subject,
    [ValidatePattern('^\.env(?:\.[a-zA-Z0-9_-]+)?$')]
    [string]$EnvFile = '.env'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$contact = $null
if (-not [Uri]::TryCreate($Subject, [UriKind]::Absolute, [ref]$contact) -or
    $contact.Scheme -notin @('mailto', 'https') -or $Subject -match '[\s"\\]') {
    throw 'Subject must be a mailto: contact or HTTPS URL without whitespace.'
}

Push-Location $root
try {
    git check-ignore --quiet -- $EnvFile
    if ($LASTEXITCODE -ne 0) { throw 'The target env file must be ignored by Git.' }
    if (git ls-files -- $EnvFile) { throw 'Refusing to write keys to a tracked file.' }
    $path = Join-Path $root $EnvFile
    $existing = if (Test-Path $path) { [IO.File]::ReadAllText($path) } else { '' }
    if ($existing -match '(?m)^\s*VAPID_(PUBLIC_KEY|PRIVATE_KEY|SUBJECT)\s*=') {
        throw 'VAPID configuration already exists. Keep stable keys; rotating them invalidates existing subscriptions.'
    }

    $key = [Security.Cryptography.ECDsa]::Create([Security.Cryptography.ECCurve+NamedCurves]::nistP256)
    $parameters = $null
    try {
        $parameters = $key.ExportParameters($true)
        [byte[]]$point = @(4) + $parameters.Q.X + $parameters.Q.Y
        $publicKey = [Convert]::ToBase64String($point).TrimEnd('=').Replace('+', '-').Replace('/', '_')
        $privateKey = [Convert]::ToBase64String($parameters.D).TrimEnd('=').Replace('+', '-').Replace('/', '_')
        $separator = if ($existing.Length -gt 0 -and -not $existing.EndsWith("`n")) { [Environment]::NewLine } else { '' }
        $newContent = $existing + $separator +
            "VAPID_PUBLIC_KEY=$publicKey`nVAPID_PRIVATE_KEY=$privateKey`nVAPID_SUBJECT=$Subject`n"
        [IO.File]::WriteAllText($path, $newContent, [Text.UTF8Encoding]::new($false))
    }
    finally {
        if ($null -ne $parameters -and $null -ne $parameters.D) { [Array]::Clear($parameters.D, 0, $parameters.D.Length) }
        $privateKey = $null
        $newContent = $null
        $key.Dispose()
    }
    Write-Output 'VAPID configuration saved to the ignored env file. Restart the API with that environment.'
}
finally { Pop-Location }

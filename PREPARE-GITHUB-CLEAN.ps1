$ErrorActionPreference = 'Stop'

$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
$Parent = Split-Path -Parent $Source
$Target = Join-Path $Parent 'JMX-GITHUB-CLEAN-PUBLISH'
$Repo = 'https://github.com/enriquezjc222-coder/jmxdigitalcard.git'

Write-Host 'JMX Digital Card - Clean GitHub preparation' -ForegroundColor Cyan
Write-Host 'This script DOES NOT push anything.' -ForegroundColor Yellow

if (Test-Path $Target) {
  Write-Host "Removing previous temporary publish folder: $Target" -ForegroundColor Yellow
  Remove-Item -Recurse -Force $Target
}

Write-Host 'Cloning the CURRENT GitHub main branch...' -ForegroundColor Cyan
git clone $Repo $Target
if ($LASTEXITCODE -ne 0) { throw 'git clone failed.' }

git -C $Target config user.name 'enriquezjc222-coder'
git -C $Target config user.email '316862702+enriquezjc222-coder@users.noreply.github.com'

Write-Host 'Overlaying this approved production build on top of the fresh GitHub clone...' -ForegroundColor Cyan
$excludeDirs = @('.git', 'functions\node_modules')
$excludeFiles = @('JMX-Digital-Card-NFC-ID-CARDS-Tooltips-PRODUCTION-CLEAN.zip')

$robocopyArgs = @($Source, $Target, '/E', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XD') + $excludeDirs + @('/XF') + $excludeFiles
& robocopy @robocopyArgs | Out-Null
if ($LASTEXITCODE -gt 7) { throw "robocopy failed with exit code $LASTEXITCODE" }

Write-Host ''
Write-Host 'Prepared clean working copy:' -ForegroundColor Green
Write-Host $Target -ForegroundColor Green
Write-Host ''
Write-Host 'Git status:' -ForegroundColor Cyan
git -C $Target status --short
Write-Host ''
Write-Host 'No commit or push was performed.' -ForegroundColor Yellow
Write-Host 'Open this new folder in VS Code when you are ready to publish.' -ForegroundColor Yellow

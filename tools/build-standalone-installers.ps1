<#
 Builds the two Windows setups on this laptop and copies them into one folder:
   EduSmart-Lesson-Plan-Generator-Setup-<version>.exe
   EduSmart-School-Timetable-Setup-<version>.exe
   powershell -ExecutionPolicy Bypass -File .\tools\build-standalone-installers.ps1
 Options: -Out "C:\Users\INGABIRE\StudioProjects\Timetable and Lesson Plan"   (where the .exe files are copied)
          -Only lesson | timetable                                            (build just one)
 Needs: Node.js LTS (winget install OpenJS.NodeJS.LTS) and about 4 GB free disk space. The first build downloads Electron (about 120 MB).
 The setups are not code-signed, so Windows SmartScreen shows "More info > Run anyway" the first time.
#>
param([string]$Out = "C:\Users\INGABIRE\StudioProjects\Timetable and Lesson Plan", [ValidateSet('both','lesson','timetable')][string]$Only = 'both')
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host "Node.js is not installed. Run: winget install OpenJS.NodeJS.LTS   then reopen PowerShell." -ForegroundColor Yellow; exit 1 }
$free = [math]::Round((Get-PSDrive ($repo.Substring(0,1))).Free / 1GB, 1)
if ($free -lt 4) { Write-Host ("Only {0} GB free on this drive. Free about 4 GB first (tools\laptop-cleanup.ps1 -Apply helps)." -f $free) -ForegroundColor Yellow; exit 1 }
New-Item -ItemType Directory -Force $Out | Out-Null
$apps = @()
if ($Only -in 'both','lesson')    { $apps += [pscustomobject]@{ Name = 'Lesson Plan Generator'; Dir = (Join-Path $repo 'lessonplan-installer') } }
if ($Only -in 'both','timetable') { $apps += [pscustomobject]@{ Name = 'School Timetable';      Dir = (Join-Path $repo 'timetable-installer') } }
$ok = @(); $bad = @()
foreach ($a in $apps) {
  Write-Host ("`n=== {0} ===" -f $a.Name) -ForegroundColor Cyan
  Push-Location $a.Dir
  Write-Host "1/2 Installing packages (retries by itself if the connection drops) ..."
  $eb = Join-Path $a.Dir 'node_modules\.bin\electron-builder.cmd'
  for ($try = 1; $try -le 5 -and -not ((Test-Path $eb) -and (Test-Path (Join-Path $a.Dir 'node_modules\electron\dist'))); $try++) {
    if ($try -gt 1) { Write-Host ("  attempt {0} of 5 ..." -f $try) -ForegroundColor Yellow; Start-Sleep -Seconds (10 * $try) }
    npm.cmd install --no-audit --no-fund --fetch-retries=6 --fetch-retry-mintimeout=15000 --fetch-retry-maxtimeout=120000 --fetch-timeout=180000 2>&1 | Select-Object -Last 2 | ForEach-Object { Write-Host ("  " + $_) }
  }
  if (-not ((Test-Path $eb) -and (Test-Path (Join-Path $a.Dir 'node_modules\electron\dist')))) {
    Write-Host "  The packages could not be downloaded (network problem). Check the internet connection or try another network, then run this script again." -ForegroundColor Red
    Pop-Location; $bad += $a.Name; continue
  }
  Write-Host "2/2 Building the setup (a few minutes) ..."
  Remove-Item -Recurse -Force (Join-Path $a.Dir 'dist') -ErrorAction SilentlyContinue
  $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  & $eb --win nsis --publish never 2>&1 | ForEach-Object { Write-Host $_ }
  $code = $LASTEXITCODE
  Pop-Location
  $exe = Get-ChildItem (Join-Path $a.Dir 'dist') -Filter '*Setup*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($code -eq 0 -and $exe) { Copy-Item $exe.FullName $Out -Force; $ok += ("{0}  ({1} MB)" -f $exe.Name, [math]::Round($exe.Length / 1MB)); Remove-Item -Recurse -Force (Join-Path $a.Dir 'dist\win-unpacked') -ErrorAction SilentlyContinue }
  else { $bad += $a.Name }
}
""
if ($ok.Count)  { Write-Host ("Ready in {0}:" -f $Out) -ForegroundColor Green; $ok | ForEach-Object { Write-Host ("  " + $_) -ForegroundColor Green } }
if ($bad.Count) { Write-Host ("Failed: " + ($bad -join ', ') + ". Scroll up for the first red line, or paste it to Claude Code.") -ForegroundColor Red; exit 1 }

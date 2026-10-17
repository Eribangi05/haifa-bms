<#
 Safe cleanup of regenerable build leftovers on the laptop. DRY RUN by default: it only lists what it would delete and the space.
   powershell -ExecutionPolicy Bypass -File .\laptop-cleanup.ps1            # list only
   powershell -ExecutionPolicy Bypass -File .\laptop-cleanup.ps1 -Apply     # delete what is listed
 It never touches source code, .git, assets/content, installers you still need (the newest 2 per product are kept), or documents.
 Everything it deletes is recreated by the next build (the next build is slower once).
#>
param([switch]$Apply, [string]$Projects = "$env:USERPROFILE\StudioProjects", [int]$KeepInstallers = 2)
$ErrorActionPreference = 'SilentlyContinue'
function Size($p){ if(Test-Path $p){ [math]::Round(((Get-ChildItem $p -Recurse -Force -File | Measure-Object Length -Sum).Sum)/1MB) } else { 0 } }
$items = New-Object System.Collections.ArrayList
function Add($label,$path){ if(Test-Path $path){ [void]$items.Add([pscustomobject]@{Label=$label;Path=$path;MB=(Size $path)}) } }

# 1. build output that the next build recreates
Add 'Windows app: unpacked build'      "$Projects\smart-school-app\dist\win-unpacked"
Add 'Android: app build folder'        "$Projects\smart-school-app-android\app\build"
Add 'Android: project .gradle cache'   "$Projects\smart-school-app-android\.gradle"
foreach($d in 'lessonplan-installer','timetable-installer'){ Add "$d dist" "$Projects\haifa-bms\$d\dist" }
# 2. old installers: keep the newest N of each product in dist\ and in installers\
foreach($dir in "$Projects\smart-school-app\dist","$Projects\installers\windows","$Projects\installers\android","$Projects\haifa-bms\lessonplan-installer\dist","$Projects\haifa-bms\timetable-installer\dist"){
  if(Test-Path $dir){
    Get-ChildItem $dir -File -Include *.exe,*.apk,*.blockmap,*.7z -Recurse:$false | Group-Object { ($_.BaseName -replace '[\d\.\-_ ]+$','' -replace '\d+(\.\d+)+','') } | ForEach-Object {
      $_.Group | Sort-Object LastWriteTime -Descending | Select-Object -Skip $KeepInstallers | ForEach-Object { [void]$items.Add([pscustomobject]@{Label='Older installer';Path=$_.FullName;MB=[math]::Round($_.Length/1MB)}) } } } }
# 3. caches
Add 'Temp files'                       $env:TEMP
Add 'npm cache'                        "$env:LOCALAPPDATA\npm-cache"
Add 'Windows Error Reporting'          "$env:LOCALAPPDATA\CrashDumps"
Add 'Gradle: old wrapper downloads'    "$env:USERPROFILE\.gradle\wrapper\dists"

$items | Sort-Object MB -Descending | Format-Table Label,MB,Path -AutoSize
"Total: {0} MB ({1:N1} GB)" -f ($items | Measure-Object MB -Sum).Sum, (($items | Measure-Object MB -Sum).Sum/1024)
if(-not $Apply){ "`nDry run only. Re-run with -Apply to delete the items above."; return }
foreach($i in $items){
  if($i.Label -eq 'Temp files'){ Get-ChildItem $i.Path -Force | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Recurse -Force }
  elseif($i.Label -eq 'Gradle: old wrapper downloads'){ Get-ChildItem $i.Path -Directory | Sort-Object LastWriteTime -Descending | Select-Object -Skip 1 | Remove-Item -Recurse -Force }
  else { Remove-Item $i.Path -Recurse -Force }
}
"Done."

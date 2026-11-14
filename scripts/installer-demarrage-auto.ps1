# Kebab (SOUCOFFE) - active (ou retire avec -Retirer) le demarrage automatique du site.
# Pas besoin des droits administrateur. Deux protections :
#   1. un raccourci dans le dossier Demarrage (lance le surveillant a l'ouverture de session) ;
#   2. une tache planifiee "Kebab - surveillant" qui relance le surveillant toutes les
#      5 minutes s'il a ete ferme (il ne tourne jamais en double : demarrage-auto.vbs
#      s'arrete tout seul si une copie tourne deja).
#   powershell -ExecutionPolicy Bypass -File scripts\installer-demarrage-auto.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\installer-demarrage-auto.ps1 -Retirer
param([switch]$Retirer)

$script = Join-Path $PSScriptRoot 'demarrage-auto.vbs'
$lien = Join-Path ([Environment]::GetFolderPath('Startup')) 'SOUCOFFE.lnk'
$tache = 'Kebab - surveillant'

if ($Retirer) {
    if (Test-Path $lien) { Remove-Item $lien }
    schtasks /Delete /TN $tache /F 2>$null | Out-Null
    Write-Output 'Demarrage automatique retire (raccourci et tache planifiee).'
    exit 0
}

$sh = New-Object -ComObject WScript.Shell
$l = $sh.CreateShortcut($lien)
$l.TargetPath = "$env:WINDIR\System32\wscript.exe"
$l.Arguments = '"' + $script + '"'
$l.WorkingDirectory = Split-Path $PSScriptRoot
$l.Description = 'Kebab - demarre la base, l API et le site'
$l.Save()
Write-Output "Raccourci de demarrage : $lien"

# Tache planifiee de l'utilisateur courant : toutes les 5 minutes, tant que la session est ouverte.
$cmd = '"' + "$env:WINDIR\System32\wscript.exe" + '" "' + $script + '"'
schtasks /Create /TN $tache /TR $cmd /SC MINUTE /MO 5 /F | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Output "Tache planifiee '$tache' : le surveillant est relance toutes les 5 minutes s'il s'arrete."
} else {
    Write-Output "Tache planifiee non creee (code $LASTEXITCODE) : le raccourci de demarrage reste actif."
}

# Lance le surveillant tout de suite (s'il tourne deja, la nouvelle copie s'arrete seule).
Start-Process "$env:WINDIR\System32\wscript.exe" -ArgumentList ('"' + $script + '"')
Write-Output 'Surveillant lance : le site sera disponible dans quelques secondes.'

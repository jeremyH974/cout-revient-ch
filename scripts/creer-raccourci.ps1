<#
.SYNOPSIS
  Cree un raccourci « Cout de revient CH » dans le menu Demarrer (et le Bureau si demande).

.DESCRIPTION
  Le raccourci pointe sur lancer-prive.cmd, porte l'icone de l'application, et demarre dans le
  dossier du depot. Rien n'est installe, rien n'est ecrit dans le registre : un .lnk, que
  -Supprimer retire.

  Sans accents, pour la meme raison que lancer-prive.ps1 : l'encodage d'un .ps1 depend de
  l'interpreteur qui le lit.

.PARAMETER Bureau
  Cree aussi le raccourci sur le Bureau.

.PARAMETER Supprimer
  Retire les raccourcis au lieu de les creer.

.EXAMPLE
  .\scripts\creer-raccourci.ps1
.EXAMPLE
  .\scripts\creer-raccourci.ps1 -Bureau
.EXAMPLE
  .\scripts\creer-raccourci.ps1 -Supprimer -Bureau
#>
[CmdletBinding()]
param(
  [switch] $Bureau,
  [switch] $Supprimer
)

$ErrorActionPreference = 'Stop'

$Racine = Split-Path -Parent $PSScriptRoot
$Cible = Join-Path $Racine 'lancer-prive.cmd'
$Icone = Join-Path $Racine 'public\favicon.ico'
$Nom = 'Cout de revient CH.lnk'

if (-not (Test-Path $Cible)) { throw "Introuvable : $Cible" }

$emplacements = @(Join-Path ([Environment]::GetFolderPath('Programs')) $Nom)
if ($Bureau) { $emplacements += Join-Path ([Environment]::GetFolderPath('Desktop')) $Nom }

if ($Supprimer) {
  foreach ($lien in $emplacements) {
    if (Test-Path $lien) { Remove-Item $lien -Force; Write-Host "Retire : $lien" }
    else { Write-Host "Absent  : $lien" -ForegroundColor DarkGray }
  }
  return
}

$shell = New-Object -ComObject WScript.Shell
foreach ($lien in $emplacements) {
  $raccourci = $shell.CreateShortcut($lien)
  $raccourci.TargetPath = $Cible
  $raccourci.WorkingDirectory = $Racine
  $raccourci.Description = 'Vos donnees, en local, sur une origine dediee et sans sortie reseau.'
  if (Test-Path $Icone) { $raccourci.IconLocation = $Icone }
  $raccourci.Save()
  Write-Host "Cree : $lien" -ForegroundColor Green
}

Write-Host ''
Write-Host 'Tapez « Cout » dans le menu Demarrer pour le retrouver.' -ForegroundColor Gray

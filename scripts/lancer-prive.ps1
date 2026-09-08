<#
.SYNOPSIS
  Lance la variante personnelle et l'ouvre dans une fenetre sans barre d'adresse.

.DESCRIPTION
  Ce script remplace un empaquetage en application de bureau (Tauri, Electron), et c'est un choix
  delibere — voir la decision correspondante dans docs/DECISIONS.md. Une application de bureau
  donnerait au code un acces PERMANENT au disque, alors que la menace principale de ce projet est
  justement une dependance npm compromise ; elle ferait aussi tomber le bac a sable du navigateur,
  la Content-Security-Policy servie en en-tete et Trusted Types. Le mode « application » d'un
  navigateur Chromium donne la meme apparence — fenetre propre, entree dans la barre des taches,
  icone — sans rien retirer de ces protections.

  Trois pieges que ce script existe pour eviter :

  1. `dist/` est PARTAGE entre le build public et le build prive. Servir un build public depuis
     l'origine privee redonnerait la sortie reseau que la variante coupe. Le script reconstruit
     donc par defaut, et refuse de servir un `dist/` public meme en mode rapide.
  2. L'adresse est `crch.localhost:7331`, jamais `localhost:7331` : ce sont deux origines, donc
     deux stockages. Se tromper d'adresse donne un ecran vide qu'on prend pour une perte.
  3. AUCUN `--user-data-dir` n'est passe au navigateur. Un profil dedie aurait son propre
     stockage : les donnees vues par le raccourci differeraient de celles vues en tapant l'adresse
     a la main. Le meme piege que le point 2, deguise.

  Ce fichier s'ecrit SANS ACCENTS, a dessein : un .ps1 en UTF-8 sans BOM est relu en ANSI par
  Windows PowerShell 5.1, et les messages sortiraient en charabia selon l'interpreteur qui le
  lance. Le reste du depot est accentue ; ce fichier-ci ne peut pas se le permettre.

.PARAMETER Rapide
  Saute la reconstruction si `dist/` porte deja un build prive. Gain : quelques secondes. Risque
  assume : le build peut dater d'avant vos dernieres modifications du code.

.PARAMETER Navigateur
  Chemin d'un navigateur Chromium a utiliser. Par defaut : Edge, puis Chrome.

.EXAMPLE
  .\scripts\lancer-prive.ps1
.EXAMPLE
  .\scripts\lancer-prive.ps1 -Rapide
#>
[CmdletBinding()]
param(
  [switch] $Rapide,
  [string] $Navigateur
)

$ErrorActionPreference = 'Stop'

$Racine = Split-Path -Parent $PSScriptRoot
$Port = 7331
$Adresse = "http://crch.localhost:$Port"
$Sonde = "http://127.0.0.1:$Port/"

function Ecrire($texte, $couleur = 'Gray') { Write-Host $texte -ForegroundColor $couleur }

# --- 1. Le build present dans dist/ est-il PRIVE ? -------------------------------------------
# Discriminant fiable et sans etat : le build public prefixe ses ressources par `/cout-revient-ch/`
# (option `base`), le build prive sert a la racine. Pas de fichier temoin a tenir a jour.
function Get-EtatDist {
  $index = Join-Path $Racine 'dist\index.html'
  if (-not (Test-Path $index)) { return 'absent' }
  if ((Get-Content $index -Raw) -match '/cout-revient-ch/assets/') { return 'public' }
  return 'prive'
}

# --- 2. Construire ----------------------------------------------------------------------------
$etat = Get-EtatDist
if ($Rapide -and $etat -eq 'prive') {
  Ecrire 'Build prive deja present : reconstruction sautee (-Rapide).' 'DarkYellow'
  Ecrire 'Il peut dater d''avant vos dernieres modifications.' 'DarkYellow'
}
else {
  if ($Rapide) {
    Ecrire "-Rapide ignore : dist/ est $etat, le servir tel quel rendrait la sortie reseau." 'DarkYellow'
  }
  Ecrire 'Construction de la variante personnelle...' 'Cyan'
  Push-Location $Racine
  try { & npm run prive:build | Out-Host }
  finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "La construction a echoue (code $LASTEXITCODE)." }
  if ((Get-EtatDist) -ne 'prive') { throw 'Le build produit ne porte pas la marque privee. Arret.' }
}

# --- 3. Serveur : reutiliser celui qui tourne deja, sinon en demarrer un -----------------------
function Test-ServeurVivant {
  try {
    $null = Invoke-WebRequest -Uri $Sonde -Method Head -TimeoutSec 2 -UseBasicParsing
    return $true
  }
  catch { return $false }
}

$serveur = $null
$demarreParNous = $false
if (Test-ServeurVivant) {
  Ecrire "Un serveur repond deja sur le port $Port : il est reutilise." 'DarkGray'
}
else {
  Ecrire 'Demarrage du serveur local (127.0.0.1 uniquement)...' 'Cyan'
  $serveur = Start-Process -FilePath 'node' -ArgumentList 'scripts/serve-prive.ts' `
    -WorkingDirectory $Racine -PassThru -WindowStyle Hidden
  $demarreParNous = $true

  $limite = (Get-Date).AddSeconds(30)
  while (-not (Test-ServeurVivant)) {
    if ($serveur.HasExited) { throw "Le serveur s'est arrete aussitot (code $($serveur.ExitCode))." }
    if ((Get-Date) -gt $limite) { throw 'Le serveur ne repond pas apres 30 s.' }
    Start-Sleep -Milliseconds 250
  }
}

# --- 4. Ouvrir le navigateur en mode application ------------------------------------------------
function Find-Navigateur {
  if ($Navigateur) {
    if (Test-Path $Navigateur) { return $Navigateur }
    throw "Navigateur introuvable : $Navigateur"
  }
  $candidats = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  foreach ($c in $candidats) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}

try {
  $exe = Find-Navigateur
  if ($exe) {
    # `--app=` : fenetre sans barre d'adresse ni onglets, avec sa propre entree dans la barre des
    # taches. AUCUN `--user-data-dir` : le profil par defaut, donc le MEME stockage que si vous
    # tapiez l'adresse a la main.
    Start-Process -FilePath $exe -ArgumentList "--app=$Adresse" | Out-Null
    Ecrire "Ouvert dans $(Split-Path $exe -Leaf) : $Adresse" 'Green'
  }
  else {
    Start-Process $Adresse | Out-Null
    Ecrire "Aucun navigateur Chromium trouve : ouvert dans le navigateur par defaut." 'DarkYellow'
    Ecrire 'Le mode « application » (fenetre sans barre d''adresse) demande Edge ou Chrome.' 'DarkGray'
  }

  Write-Host ''
  Ecrire 'Cout de revient CH - variante personnelle' 'White'
  Ecrire "  Adresse   : $Adresse" 'Gray'
  Ecrire '  Ecoute    : 127.0.0.1 seulement — rien n''est joignable depuis le reseau.' 'Gray'
  Ecrire '  Reseau    : sortie coupee au demarrage (Reglages pour l''ouvrir le temps d''une session).' 'Gray'
  Write-Host ''
  if ($demarreParNous) {
    # `[Console]::KeyAvailable` LEVE une exception quand l'entree est redirigee (lancement depuis
    # un script, une tache planifiee, un terminal sans console). Sans ce repli, l'exception
    # partirait dans le `finally`, qui arreterait le serveur aussitot apres l'avoir demarre.
    $interactif = $true
    try { $null = [Console]::KeyAvailable } catch { $interactif = $false }
    if ($interactif) {
      Ecrire 'Laissez cette fenetre ouverte. Une touche, ou Ctrl+C, pour arreter le serveur.' 'Yellow'
      while (-not [Console]::KeyAvailable) { Start-Sleep -Milliseconds 200 }
      $null = [Console]::ReadKey($true)
    }
    else {
      Ecrire 'Entree non interactive : Ctrl+C pour arreter le serveur.' 'Yellow'
      Wait-Process -Id $serveur.Id
    }
  }
  else {
    Ecrire 'Le serveur etait deja lance : cette fenetre peut etre fermee.' 'DarkGray'
  }
}
finally {
  # Ne jamais arreter un serveur qu'on n'a pas demarre : une autre fenetre s'en sert peut-etre.
  if ($demarreParNous -and $serveur -and -not $serveur.HasExited) {
    Ecrire 'Arret du serveur...' 'DarkGray'
    Stop-Process -Id $serveur.Id -Force -ErrorAction SilentlyContinue
  }
}

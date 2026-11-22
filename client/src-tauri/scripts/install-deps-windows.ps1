# Instala todas las dependencias de Hazel (cliente + nodo) en Windows.
$ErrorActionPreference = 'Continue'

function Write-Log($message) { Write-Host "[hazel] $message" }

function Install-Winget($id) {
  Write-Log "Instalando $id..."
  winget install --exact --id $id --accept-source-agreements --accept-package-agreements
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Log "winget no está disponible; instala App Installer desde Microsoft Store."
  exit 1
}

Install-Winget 'Docker.DockerDesktop'
Install-Winget 'Microsoft.EdgeWebView2Runtime'
Install-Winget 'Microsoft.VisualStudio.2022.BuildTools'
Install-Winget 'OpenJS.NodeJS.LTS'

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Write-Log "Instalando Rust..."
  Invoke-WebRequest -Uri 'https://sh.rustup.rs' -UseBasicParsing | Invoke-Expression
}

Write-Log "Dependencias instaladas."

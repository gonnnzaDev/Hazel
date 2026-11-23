# Instala todas las dependencias de Hazel (cliente + nodo) en Windows.
$ErrorActionPreference = 'Continue'

function Write-Log($message) { Write-Host "[hazel] $message" }
function Write-Progress-Step($percent, $label) { Write-Host "@@HAZEL_PROGRESS@@$percent|$label" }

function Install-Winget($id) {
  Write-Log "Instalando $id..."
  winget install --exact --id $id --accept-source-agreements --accept-package-agreements
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Log "winget no está disponible; instala App Installer desde Microsoft Store."
  exit 1
}

Write-Progress-Step 15 'Instalando Docker Desktop...'
Install-Winget 'Docker.DockerDesktop'
Write-Progress-Step 35 'Instalando WebView2...'
Install-Winget 'Microsoft.EdgeWebView2Runtime'
Write-Progress-Step 50 'Instalando Build Tools...'
Install-Winget 'Microsoft.VisualStudio.2022.BuildTools'
Write-Progress-Step 65 'Instalando Node.js...'
Install-Winget 'OpenJS.NodeJS.LTS'

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Write-Progress-Step 85 "Instalando Rust..."
  Write-Log "Instalando Rust..."
  Invoke-WebRequest -Uri 'https://sh.rustup.rs' -UseBasicParsing | Invoke-Expression
}

Write-Progress-Step 100 "Dependencias instaladas."
Write-Log "Dependencias instaladas."

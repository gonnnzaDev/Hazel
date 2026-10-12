# Instalación

Un comando en las cuatro plataformas. Los scripts hacen lo mismo en todas y
terminan con el mismo entorno, porque las versiones salen de `uv.lock` y de
`.python-version`.

| Plataforma | Comando | Requisitos previos |
|---|---|---|
| Linux | `./scripts/setup.sh` | `git` y `curl` |
| macOS | `./scripts/setup.sh` | `git` (Xcode tools) |
| Windows | `.\scripts\setup.ps1` | Git para Windows |
| Android | `./scripts/setup.sh` en Termux | `git`, `curl` |

**No hace falta tener Python instalado.** `uv` trae su propio interpreter
Python, y `.python-version` fija cuál. Por eso todos terminan con exactamente la
misma versión.

---

## Linux

```bash
git clone https://github.com/gonnnzaDev/recop
cd recop
./scripts/setup.sh
```

Necesitás `curl`. En Debian/Ubuntu:

```bash
sudo apt install -y git curl
```

En Fedora:

```bash
sudo dnf install -y git curl
```

En Arch:

```bash
sudo pacman -S --needed git curl
```

---

## macOS

```bash
git clone https://github.com/gonnnzaDev/recop
cd recop
./scripts/setup.sh
```

macOS viene con `curl`. `git` viene con las Command Line Tools de Xcode; si no
las tenés, el instalador te las ofrece solo.

Si te aparece un error de permisos al instalar `uv` en `/usr/local`, el script
cae a `~/.local/bin` automáticamente.

---

## Windows

```powershell
git clone https://github.com/gonnnzaDev/recop
cd recop
.\scripts\setup.ps1
```

Si PowerShell bloquea la ejecución de scripts:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

Para no tener que hacer eso cada vez, en PowerShell como administrador:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Necesitás [Git para Windows](https://git-scm.com/download/win) y, para el
stack completo, [Docker Desktop](https://www.docker.com/products/docker-desktop/).

---

## Android (Termux)

Android no corre Docker nativo. La vía es **Termux**, que sí lo corre en
Android 7 en adelante.

Instalá Termux desde **F-Droid**, no desde el Play Store: la versión del Play
Store está congelada en una versión vieja que rompe la instalación.

```bash
# 1. Termux → pkg install
pkg update && pkg upgrade
pkg install -y git curl clang libjpeg-turbo python

# 2. Clonar e instalar
git clone https://github.com/gonnnzaDev/recop
cd recop
./scripts/setup.sh
```

El script detecta Termux y lo dice. Si no tenés Docker, te dice cómo
configurarlo:

```bash
pkg install -y docker
# Si no está en tu repo, sumá el repo 'tur':
pkg install tur-repo
pkg install -y docker
```

Después hay que darle acceso al socket, que en Android requiere un paso extra
por las restricciones del kernel. **El camino más simple en Android es no usar
Docker**: apuntá `RECOP_DATABASE_URL` y `RECOP_KAFKA_BOOTSTRAP_SERVERS` en el
`.env` a unas bases de datos que ya tengas en otra máquina de la red, y corré
las migraciones.

La imagen de Docker es multi-arquitectura y corre en `linux/arm64-v8` (Android
64-bit) y `linux/arm/v7` (Android 32-bit), así que donde Docker funcione, la
imagen funciona.

> **Pendiente:** falta probar el camino de Termux de punta a punta. Los scripts
> lo contemplan, pero no lo verifiqué en un dispositivo real. Si te pasa algo
> raro ahí, es el primer lugar donde mirar.

---

## Qué hace el script

1. Detecta la plataforma (Linux, macOS, Windows, Termux)
2. Instala `uv` si no está
3. `uv sync --locked` — instala **exactamente** lo que dice `uv.lock`
4. Crea el `.env` con un `RECOP_SECRET_KEY` generado
5. Levanta PostgreSQL y Kafka con Docker, si hay Docker
6. Aplica las migraciones

Es **idempotente**: correrlo dos veces no rompe nada. Si el `.env` ya existe, no
lo toca.

### Lo que garantiza

Que todos tengan lo mismo no es prometido, es mecánico:

- **Python**: `.python-version` dice `3.13`. `uv` descarga esa versión si no la
  tiene.
- **Dependencias**: `uv.lock` tiene la versión exacta de cada paquete, con sus
  hashes. `uv sync --locked` falla si el lock no coincide con `pyproject.toml`,
  así que nadie puede instalar sin querer una versión distinta.
- **Configuración**: los valores por defecto salen de `.env.example`, que es el
  mismo archivo para todos.

---

## Comandos de uso diario

`make` no está en todas las máquinas, así que hay un equivalente en shell y
otro en PowerShell. Los tres hacen lo mismo.

```bash
./scripts/recop.sh up           # levantar PostgreSQL y Kafka
./scripts/recop.sh api          # arrancar el nodo
./scripts/recop.sh check        # lint + formato + tipos + tests
./scripts/recop.sh help         # todos los comandos
```

```powershell
.\scripts\recop.ps1 up
.\scripts\recop.ps1 api
.\scripts\recop.ps1 check
.\scripts\recop.ps1 help
```

```bash
make up
make api
make check
make help
```

---

## Problemas frecuentes

**`docker: permission denied` en Linux**

```bash
sudo usermod -aG docker $USER
# cerrá la sesión y volvé a abrirla
```

**PowerShell dice "no se puede cargar el archivo"**

El problema es la política de ejecución, no el script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

**Los acentos se ven raros en Windows**

`setup.ps1` y `recop.ps1` llevan BOM UTF-8 a propósito. Windows PowerShell 5.1
lee los `.ps1` sin BOM como ANSI y destroza los acentos. Si tu editor te saca el
BOM al guardar, volvé a ponérselo.

**`uv sync` falla con "the lockfile is not up to date"**

Alguien cambió `pyproject.toml` sin regenerar el lock. Si no sos vos:

```bash
uv lock
```

**No me entra nadie desde la red local**

El puerto tiene que estar publicado en todas las interfaces, no solo en
localhost. En Docker, `RECOP_PUBLISH_HOST=0.0.0.0`. Y el firewall del sistema
tiene que dejarlo pasar.

---

## Desinstalar

No hay nada que instalar en el sistema: el script deja todo dentro del proyecto.

```bash
rm -rf .venv          # el entorno de Python
rm .env               # tu configuración y secreto
```

Si usaste Docker:

```bash
./scripts/recop.sh down       # para los servicios
./scripts/recop.sh reset      # para los servicios y borra los volúmenes
```

`reset` **borra la base de datos**. Es el comando destructivo; usalo solo si
querés empezar de cero.
# Installation

One command on all four platforms. Scripts do the same everywhere and end with
the same environment, because versions come from `uv.lock` and
`requires-python` in `pyproject.toml`.

| Platform | Command | Prerequisites |
|---|---|---|
| Linux | `./scripts/setup.sh` | `git` and `curl` |
| macOS | `./scripts/setup.sh` | `git` (Xcode tools) |
| Windows | `.\scripts\setup.ps1` | Git for Windows |
| Android | `./scripts/setup.sh` in Termux | `git`, `curl` |

**No need to have Python installed.** `uv` brings its own Python interpreter
matching `requires-python` in `pyproject.toml`.

---

## Linux

```bash
git clone https://github.com/gonnnzaDev/hazel
cd hazel
./scripts/setup.sh
```

You need `curl`. On Debian/Ubuntu:

```bash
sudo apt install -y git curl
```

On Fedora:

```bash
sudo dnf install -y git curl
```

On Arch:

```bash
sudo pacman -S --needed git curl
```

---

## macOS

```bash
git clone https://github.com/gonnnzaDev/hazel
cd hazel
./scripts/setup.sh
```

macOS ships `curl`. `git` ships with Xcode Command Line Tools; if you don't
have them, the installer offers them automatically.

If you get a permission error installing `uv` to `/usr/local`, the script falls
back to `~/.local/bin` automatically.

---

## Windows

```powershell
git clone https://github.com/gonnnzaDev/hazel
cd hazel
.\scripts\setup.ps1
```

If PowerShell blocks script execution:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

To avoid doing that every time, in PowerShell as administrator:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

You need [Git for Windows](https://git-scm.com/download/win) and, for the full
stack, [Docker Desktop](https://www.docker.com/products/docker-desktop/).

---

## Android (Termux)

Android doesn't run native Docker. The way in is **Termux**, which does run it
on Android 7 and up.

Install Termux from **F-Droid**, not from the Play Store: the Play Store version
is frozen on an old version that breaks installation.

```bash
# 1. Termux → pkg install
pkg update && pkg upgrade
pkg install -y git curl clang libjpeg-turbo python

# 2. Clone and install
git clone https://github.com/gonnnzaDev/hazel
cd hazel
./scripts/setup.sh
```

The script detects Termux and says so. If you don't have Docker, it tells you
how to set it up:

```bash
pkg install -y docker
# If it's not in your repo, add the 'tur' repo:
pkg install tur-repo
pkg install -y docker
```

Then you must grant socket access, which on Android takes an extra step due to
kernel restrictions. **The simplest path on Android is not using Docker**: point
`HAZEL_DATABASE_URL` and `HAZEL_KAFKA_BOOTSTRAP_SERVERS` in `.env` to databases
you already have on another machine on the network, and run migrations.

The Docker image is multi-architecture and runs on `linux/arm64-v8` (64-bit
Android) and `linux/arm/v7` (32-bit Android), so wherever Docker works, the
image works.

> **Pending:** the Termux path still needs end-to-end testing. Scripts account
> for it, but I haven't verified it on a real device. If something weird happens
> there, that's the first place to look.

---

## What the script does

1. Detects the platform (Linux, macOS, Windows, Termux)
2. Installs `uv` if missing
3. `uv sync --locked` — installs **exactly** what `uv.lock` says
4. Creates `.env` with a generated `HAZEL_SECRET_KEY`
5. Brings up PostgreSQL and Kafka with Docker, if Docker exists
6. Applies migrations

It's **idempotent**: running it twice breaks nothing. If `.env` already exists,
it doesn't touch it.

### What it guarantees

That everyone has the same isn't promised, it's mechanical:

- **Python**: `requires-python` in `pyproject.toml` says `>=3.14`. `uv`
  downloads a matching version if it doesn't have one.
- **Dependencies**: `uv.lock` pins the exact version of each package, with
  hashes. `uv sync --locked` fails if the lock doesn't match `pyproject.toml`,
  so nobody can accidentally install a different version.
- **Configuration**: defaults live in `src/config/conf.py`, the same for
  everyone. Only `HAZEL_SECRET_KEY` must be unique per install.

---

## Daily-use commands

`make` isn't on every machine, so there's a shell equivalent and a PowerShell
one. All three do the same.

```bash
./scripts/hazel.sh up           # bring up PostgreSQL and Kafka
./scripts/hazel.sh api          # start the node
./scripts/hazel.sh check        # lint + format + types + tests
./scripts/hazel.sh help         # all commands
```

```powershell
.\scripts\hazel.ps1 up
.\scripts\hazel.ps1 api
.\scripts\hazel.ps1 check
.\scripts\hazel.ps1 help
```

```bash
make up
make api
make check
make help
```

---

## Frequent issues

**`docker: permission denied` on Linux**

```bash
sudo usermod -aG docker $USER
# log out and back in
```

**PowerShell says "cannot load file"**

That's the execution policy, not the script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

**Accents look weird on Windows**

`setup.ps1` and `hazel.ps1` carry a UTF-8 BOM on purpose. Windows PowerShell 5.1
reads `.ps1` without BOM as ANSI and mangles accents. If your editor strips the
BOM on save, put it back.

**`uv sync` fails with "the lockfile is not up to date"**

Someone changed `pyproject.toml` without regenerating the lock. If it wasn't you:

```bash
uv lock
```

**Nobody can join me from the local network**

The port must be published on all interfaces, not just localhost. In Docker,
`HAZEL_PUBLISH_HOST=0.0.0.0`. And the system firewall must let it through.

---

## Uninstall

Nothing is installed on the system: the script leaves everything inside the project.

```bash
rm -rf .venv          # Python environment
rm .env               # your config and secret
```

If you used Docker:

```bash
./scripts/hazel.sh down       # stop services
./scripts/hazel.sh reset      # stop services and delete volumes
```

`reset` **deletes the database**. It's the destructive command; use it only if
you want to start from scratch.

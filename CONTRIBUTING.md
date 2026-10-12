
# Contribuir a Recop

¡Gracias por querer sumarte! Recop es un proyecto chico y cualquier ayuda sirve: código, tests, documentación o reportar errores.

---

## Antes de empezar

- Si encontraste un error o tenés una idea, **abrí un issue primero** y contanos qué querés hacer. Así evitamos que trabajes en algo que ya está en marcha.
- No hace falta pedir permiso para arreglar errores de tipeo o mejorar la documentación: mandá el PR directo.

---

## Cómo mandar tus cambios

No se puede subir código directo a este repositorio. Todo entra por **fork + pull request**:

### 1. Hacé un fork

Entrá a [github.com/gonnnzaDev/recop](https://github.com/gonnnzaDev/recop) y tocá el botón **Fork** (arriba a la derecha). Eso crea una copia del proyecto en tu cuenta.

### 2. Clonalo en tu compu

```bash
git clone https://github.com/TU-USUARIO/recop
cd recop
git remote add upstream https://github.com/gonnnzaDev/recop
```

### 3. Armá el entorno

Necesitás Python 3.13+, [uv](https://docs.astral.sh/uv/) y Docker.

```bash
uv sync
cp .env.example .env
make up                      # levanta PostgreSQL y Kafka
uv run alembic upgrade head
make api                     # arranca el nodo
```

### 4. Creá una rama para tu cambio

Nunca trabajes sobre `main`. Usá un nombre que diga qué hacés:

```bash
git checkout -b fix/error-al-apagar-servidor
```

### 5. Hacé tus cambios y probá

```bash
make check   # lint + formato + tipos + tests
make test    # solo tests
make test-integration RECOP_TEST_DATABASE_URL=postgresql+asyncpg://recop:recop@localhost:5432/recop_test
```

**Tu PR tiene que pasar `make check`.** Si agregás algo nuevo, agregá también su test.

### 6. Subí tu rama

```bash
git add .
git commit -m "Arregla el error al apagar un servidor"
git push origin fix/error-al-apagar-servidor
```

### 7. Abrí el pull request

Andá a tu fork en GitHub y vas a ver un botón **Compare & pull request**. Tocalo y completá:

- **Qué cambia** y **por qué**.
- Si resuelve un issue, escribí `Closes #123` (con el número del issue).
- Cómo lo probaste.

Yo lo reviso, te dejo comentarios si hace falta, y cuando esté listo lo sumo.

---

## Mantener tu fork al día

Antes de empezar algo nuevo, traé los últimos cambios:

```bash
git checkout main
git fetch upstream
git merge upstream/main
git push origin main
```

---

## Cómo está armado el código

```
recop/
├── apps/            # cada módulo es autocontenido
│   ├── common/      #   tipos, errores, reglas de nickname
│   ├── servers/     #   ciclo de vida del servidor
│   ├── identity/    #   nicknames y tokens      ← pendiente
│   ├── channels/    #   salas de chat           ← pendiente
│   └── chat/        #   Kafka + WebSocket       ← pendiente
├── core/            # configuración, base de datos, app factory
├── migrations/      # Alembic
└── tests/
```

Cada app tiene siempre las mismas cuatro capas:

| Archivo | Qué hace |
|---|---|
| `models.py` | Los datos y cómo se guardan |
| `schemas.py` | Qué entra y qué sale |
| `services.py` | Las reglas del negocio |
| `api/` | Conecta HTTP con el service |

**Regla importante:** `services.py` nunca importa FastAPI. Así se puede testear sin levantar nada y sirve igual para un futuro cliente mobile.

Si cambiás un modelo, creá la migración con Alembic y subila en el mismo PR.

---

## En qué podés ayudar

Lo que falta hoy:

- Nicknames y entrada a un servidor (`identity`)
- Canales (`channels`)
- Chat con Kafka y WebSocket (`chat`)
- Instaladores para Windows, macOS, Linux y Android (Termux)

También se agradecen: más tests, mejoras en la documentación y pruebas en distintos sistemas operativos.

Para entender las decisiones de diseño, leé [`docs/architecture.md`](docs/architecture.md). Los endpoints están en [`docs/api.md`](docs/api.md).

---

## Pautas rápidas

- Un PR, un tema. Los cambios chicos y enfocados se revisan más rápido.
- Mensajes de commit claros, en español, que expliquen qué hace el cambio.
- Respetá el estilo del código existente; `make check` te avisa si algo no cuadra.
- Sé amable en issues y comentarios. Acá todos estamos aprendiendo.

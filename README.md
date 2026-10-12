<h1 align="center">Recop</h1>

<p align="center">
  <b>Tu chat. Tu máquina. Tu puerto.</b><br>
  Un chat para charlar con tus amigos, sin empresas en el medio.
</p>

<p align="center">
  <a href="#-qué-es">Qué es</a> ·
  <a href="#-cómo-empezar">Cómo empezar</a> ·
  <a href="#-cómo-se-usa">Cómo se usa</a> ·
  <a href="#-para-quienes-quieran-meter-mano">Para desarrolladores</a>
</p>

---

## ✨ Qué es

Recop es un chat parecido a Discord, pero con una diferencia enorme: **nadie te lo hospeda. Lo hospedás vos.**

Es así de simple:

1. Prendés tu servidor en tu propia compu.
2. Le pasás tu dirección a tus amigos.
3. ¡A chatear!
4. Cuando te cansás, lo apagás y listo. Se cierra todo.

**Sin cuentas.** Entrás con un nombre y ya está. Y si el mismo nombre existe en dos servidores distintos, son dos personas distintas.

**Sin empresa en el medio.** Si el servicio se cae, es porque apagaste tu compu. Nada más.

---

## 🚀 Cómo empezar

### La forma fácil (con Docker)

Es la manera más segura de que a todos les funcione igual:

```bash
git clone https://github.com/gonnnzaDev/recop
cd recop
cp .env.example .env
docker compose up
```

### La forma manual

Necesitás tener instalados Python 3.13+, PostgreSQL y Kafka.

```bash
uv sync
cp .env.example .env
docker compose up -d
uv run alembic upgrade head
uv run python -m core
```

> 🛠️ **Muy pronto:** un instalador de un solo paso para Linux, macOS, Windows y Android (Termux). Por ahora toca hacerlo a mano.

---

## 🎮 Cómo se usa

Primero, prendé todo:

```bash
make up     # enciende la base de datos y Kafka
make api    # arranca tu nodo
```

Después, en otra terminal, creá tu servidor:

```bash
curl -X POST localhost:7272/api/v1/servers \
  -H 'Content-Type: application/json' \
  -d '{"name":"Casa de Luis","slug":"casa-de-luis",
       "owner_nickname":"luis","bind_port":7272}'
```

Te devuelve un `id` y tu puerto queda abierto. 🎉

**Y después, lo de todos los días:**

```bash
# Ver qué dirección pasarles a tus amigos
curl localhost:7272/api/v1/servers/{id}/address

# Ver todos tus servidores
curl localhost:7272/api/v1/servers

# Apagar un servidor (no se pierde nada)
curl -X POST localhost:7272/api/v1/servers/{id}/deactivate

# Volver a prenderlo
curl -X POST localhost:7272/api/v1/servers/{id}/activate
```

### 💡 Los cuatro estados de un servidor

| Estado | Puerto | Tus datos |
|---|---|---|
| 🟢 **Activo** | Abierto | Intactos |
| 🌙 **Apagado a propósito** | Cerrado | Intactos |
| 💤 **Apagado porque se cayó** | Cerrado | Intactos |
| 🗑️ **Eliminado** | Cerrado | Borrados |

**Apagar nunca borra nada.** Si tu compu se reinicia o el programa se cierra, al volver a arrancar tus servidores aparecen apagados pero con todo adentro. Los prendés de nuevo y siguen ahí, como los dejaste.

---

## 🧑‍💻 Para quienes quieran meter mano

```bash
make check   # revisa que todo esté prolijo y funcione
make test    # corre las pruebas
make test-integration RECOP_TEST_DATABASE_URL=postgresql+asyncpg://recop:recop@localhost:5432/recop_test
```

### Cómo está ordenado el proyecto

```
recop/
├── apps/            # cada módulo vive por su cuenta
│   ├── common/      #   piezas compartidas
│   ├── servers/     #   prender, apagar y borrar servidores
│   ├── identity/    #   nombres de usuario        (próximamente)
│   ├── channels/    #   salas de chat             (próximamente)
│   └── chat/        #   mensajes en vivo          (próximamente)
├── core/            # el corazón de la app
├── migrations/      # cambios en la base de datos
└── tests/
```

Cada módulo se organiza igual, en cuatro partes:

| Archivo | Para qué sirve |
|---|---|
| `models.py` | Qué datos se guardan |
| `schemas.py` | Qué entra y qué sale |
| `services.py` | Las reglas de cada cosa |
| `api/` | La conexión con el mundo exterior |

Todo está pensado para que más adelante se pueda sumar una app de celular sin reescribir nada.

### 📚 Para leer más

- [`docs/api.md`](docs/api.md): los 57 endpoints y qué hace cada uno
- [`docs/architecture.md`](docs/architecture.md): por qué se decidió cada cosa
- [`CONTRIBUTING.md`](CONTRIBUTING.md): cómo sumarte al proyecto

---

## 🌱 Cómo va el proyecto

Recop está en **beta temprana**: la parte de servidores ya funciona, pero el chat todavía no.

**Lo que viene:**

- [ ] Elegir tu nombre y entrar a un servidor
- [ ] Canales para charlar
- [ ] Mensajes en vivo
- [ ] Instaladores para Windows, macOS, Linux y Android

---

## 📄 Licencia

Por definir.

---

<p align="center">Hecho para charlar con amigos, sin pedirle permiso a nadie. 💬</p>

# Cómo contribuir

## Levantar el proyecto

```bash
git clone https://github.com/gonnnzaDev/recop
cd recop
make install
make up        # PostgreSQL + Kafka
make migrate
make api
```

## Antes de abrir un PR

```bash
make check
```

Corre lint, formato, tipos y tests. Los cuatro tienen que pasar.

Si tocaste modelos de base de datos, generá la migración:

```bash
make revision m="lo que cambiaste"
```

## Cómo está armado el proyecto

Recop se divide en **apps**. Cada app es un módulo autocontenido bajo `apps/`
que tiene siempre las mismas cuatro capas:

| Capa | Archivo | Qué hace | ¿Sabe de HTTP? |
|---|---|---|---|
| Model | `models.py` | Los datos y cómo se guardan | No |
| Schema | `schemas.py` | Qué entra y qué sale | No |
| Service | `services.py` | Las reglas del negocio | **No** |
| View | `api/` | Conectar HTTP con el service | Sí |

### La regla que no se rompe

**`services.py` nunca importa FastAPI.**

Es la regla que sostiene el resto. Si un service necesita responder un 404, no
lanza un `HTTPException`: lanza `NotFoundError`, que está en
`core/api/errors.py`. Un handler global lo traduce a `application/problem+json`.

La razón no es purismo: es que el service se pueda testear sin levantar la API, y
que mañana el mismo código serve tanto al cliente de PC como al de mobile.

### Agregar una app nueva

1. Creá `apps/<nombre>/` con `models.py`, `schemas.py`, `services.py` y `api/`.
2. Registrala en `INSTALLED_APPS`, en `core/registry.py`. **Es el único lugar**
   donde se agrega o quita una app, y define el orden en que Alembic ve los
   modelos.

## Estilo

- Type hints en todo. `mypy` corre en modo `strict`.
- Línea de 100 caracteres. `ruff format` decide.
- Docstrings en español, explicando **por qué**, no **qué**. El código ya dice
  qué hace.
- Comentarios en español. Código e identificadores en inglés.

## Pull requests

Una funcionalidad por PR. Si son cambios separados, son PRs separados.

El PR tiene que explicar **qué** cambió y **por qué**, y mencionar cualquier
decisión de producto que tomes. Las decisiones de producto no son tuyas: si algo
no está decidido, preguntá en vez de elegir.

## Documentación

- `docs/api.md`: los endpoints. Si agregás un endpoint, actualizalo.
- `docs/architecture.md`: el **por qué** de cada decisión.

Las dos están escritas para que alguien nuevo entienda el proyecto sin hablar con
nadie.
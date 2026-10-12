"""Apps de Recop.

Cada subpaquete es autocontenido y sigue el mismo layout:

    models.py    → capa Model   (SQLAlchemy async)
    schemas.py   → capa Schema  (contratos Pydantic de entrada/salida)
    services.py  → capa Service (lógica de negocio, sin conocimiento de HTTP)
    api/         → capa View    (bindings HTTP, delega en services)

Las apps se registran explícitamente en `core/registry.py`.
"""

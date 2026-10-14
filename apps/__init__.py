"""Recop apps.

Each subpackage is self-contained with the same layout:

    models.py    → Model layer   (async SQLAlchemy)
    schemas.py   → Schema layer  (Pydantic in/out contracts)
    services.py  → Service layer (business logic, no HTTP knowledge)
    api/         → View layer    (HTTP bindings, delegate to services)

Apps register explicitly in `core/registry.py`.
"""

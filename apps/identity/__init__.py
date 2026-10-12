"""Identidad: cómo es una persona dentro de un servidor.

Acá vive la idea central del producto: **no hay cuentas globales**. Alguien abre
el puerto de un nodo, elige un nickname y entra. Sin email, sin password, sin
registro, sin cuenta global.

El mismo nickname en dos servidores distintos son dos personas sin relación entre
sí. Por eso el token está scopeado al servidor: el token de Ana en `casa-de-luis`
no sirve en `gym-de-martes`. No es un detalle de implementación, es el modelo.
"""

__all__: list[str] = []

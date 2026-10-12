"""El nodo: el proceso Recop corriendo en la máquina del dueño.

El nodo es lo que se instala, lo que se levanta y lo que comparte su dirección.
Escucha en **un solo puerto** y hospeda varios servidores adentro.

El ciclo de vida del puerto es el del proceso: mientras el nodo corre, el puerto
está abierto; cuando se apaga, se cierra y no se entra a ningún servidor. Apagar
el nodo nunca borra datos.

Esta app no tiene `models.py`: el nodo no tiene persistencia propia. Es
configuración y lectura del entorno.
"""

__all__: list[str] = []

"""Señalización WebRTC nativa para llamadas de voz y vídeo.

Este módulo es el **servidor de señalización** de Recop. No implementa WebRTC:
implementa lo que WebRTC necesita alrededor, que es el intercambio de mensajes
de negocio (SDP, candidatos ICE, estado de micrófono y cámara) entre los
participantes de una llamada.

## Por qué un servidor de señalización propio y no un SFU

WebRTC, sin servidor de por medio, es *peer-to-peer*: cada par de participantes
abre su propio canal de datos. Lo único que no puede ser P2P es el **apretón
inicial**: dos pares que no se conocen necesitan a alguien que los presente y
les pase las descripciones de sesión (SDP). Ese alguien es este módulo.

Para los grupos que Recop busca servir —gente que se junta en su propia
máquina, en cantidades chicas— el *full-mesh* (cada uno conectado con todos)
alcanza de sobra y es lo más simple de operar: el dueño no tiene que mantener
un servidor de medios que reenvíe audio y vídeo. Si en el futuro hiciera falta
escalar a muchos participantes por llamada, se reemplazaría el transporte (un
SFU) sin tocar la lógica de sala, porque está aislada acá.

## El modelo

- Una **llamada** es una sala identificada por `channel_id`. Los canales de voz
  (`ChannelKind.VOICE`) son salas persistentes: entrás y salís, como en Discord.
- Un **participante** es un miembro con una conexión abierta. El servidor solo
  conoce su identidad y su estado; el audio y el vídeo viajan directo entre los
  navegadores, nunca por acá.
- El `CallManager` es un singleton **por proceso**. Como cada grupo corre en su
  propio proceso, cada grupo tiene sus propias salas sin compartir estado.

Nada de esto toca la base de datos: es estado en memoria, válido mientras el
proceso vive. Si el proceso se cae, las llamadas se cortan y los clientes
reconectan —que es exactamente el modelo de "un proceso por grupo".
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

#: Función con la que un participante recibe mensajes salientes.
#:
#: En producción es `websocket.send_json`. Guardar el *callback* y no el
#: WebSocket desacopla al gestor de FastAPI: se puede testear con un `send`
#: falso que solo registre lo que llegó, sin levantar HTTP.
PeerSend = Callable[[dict[str, object]], Awaitable[None]]

#: Tipos de mensaje que el servidor reenvía tal cual entre pares, completando
#: quién es el emisor. El contenido (`sdp`, `candidate`) es opaco para el
#: servidor: lo pasa sin interpretarlo.
_FORWARDED = frozenset({"offer", "answer", "ice"})


@dataclass(slots=True)
class Peer:
    """Un participante conectado a una llamada.

    No es una fila de base: es la vista que el señalizador necesita de una
    persona mientras está en llamada. `send` se asigna al entrar.
    """

    member_id: str
    nickname: str
    display_name: str
    mic_on: bool = True
    cam_on: bool = False
    send: PeerSend | None = None

    def public(self) -> dict[str, object]:
        """La vista pública del participante, la que ven los demás.

        No incluye `send`: es el detalle de transporte, no del dominio. Lo que
        los demás necesitan saber es *quién* está y *cómo* está (mic, cámara),
        para armar la UI y decidir a quién ofrecerle una conexión.
        """
        return {
            "member_id": self.member_id,
            "nickname": self.nickname,
            "display_name": self.display_name,
            "mic": self.mic_on,
            "cam": self.cam_on,
        }


@dataclass(slots=True)
class Room:
    """Una llamada activa: los participantes conectados a un canal."""

    channel_id: str
    peers: dict[str, Peer] = field(default_factory=dict)

    @property
    def is_empty(self) -> bool:
        return not self.peers


class CallManager:
    """Estado de todas las llamadas de este proceso, con su concurrencia.

    Tres operaciones de escritura —entrar, salir, cambiar estado— y dos de
    lectura —enviar a uno, enviar a todos—. Todas pasan por el mismo
    `asyncio.Lock`: las corrutinas cooperan en un único hilo, pero un envío de
    red es un `await` que puede ceder el control a mitad de una operación, y sin
    lock dos personas entrando a la vez podrían dejar el diccionario inconsistente.

    Los envíos se hacen **fuera** del lock a propósito: esperar a que un
    WebSocket acepte bytes no debe bloquear a los demás participantes.
    """

    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}
        self._lock = asyncio.Lock()

    async def join(self, channel_id: str, peer: Peer) -> list[Peer]:
        """Registra un participante y devuelve quién estaba antes que él.

        La lista de "los que ya estaban" es lo que necesita el recién llegado
        para saber a quién ofrecerle conexión: el servidor le presenta la sala,
        y de ahí en más el mano a mano es entre los navegadores.
        """
        async with self._lock:
            room = self._rooms.setdefault(channel_id, Room(channel_id=channel_id))
            existing = [p for mid, p in room.peers.items() if mid != peer.member_id]
            room.peers[peer.member_id] = peer
        logger.info(
            "llamada %s: entra %s (%d presentes)", channel_id, peer.nickname, len(existing) + 1
        )
        return existing

    async def leave(self, channel_id: str, member_id: str) -> list[Peer]:
        """Saca un participante y devuelve quién queda.

        Si la sala queda vacía se borra: una llamada sin nadie no es una
        llamada, es una entrada colgada en un diccionario.
        """
        async with self._lock:
            room = self._rooms.get(channel_id)
            if room is None:
                return []
            room.peers.pop(member_id, None)
            remaining = list(room.peers.values())
            if room.is_empty:
                del self._rooms[channel_id]
        logger.info("llamada %s: sale %s (quedan %d)", channel_id, member_id, len(remaining))
        return remaining

    async def set_state(
        self, channel_id: str, member_id: str, *, mic: bool, cam: bool
    ) -> Peer | None:
        """Actualiza micrófono/cámara de un participante. Devuelve el peer nuevo.

        Devuelve `None` si ese miembro ya no está en la sala: quien se fue no
        tiene estado que propagar.
        """
        async with self._lock:
            room = self._rooms.get(channel_id)
            peer = room.peers.get(member_id) if room is not None else None
            if peer is not None:
                peer.mic_on = mic
                peer.cam_on = cam
        return peer

    async def send_to(self, channel_id: str, member_id: str, message: dict[str, object]) -> bool:
        """Entrega un mensaje a un solo participante.

        Es el camino de `offer`, `answer` y los candidatos ICE: son de uno a
        uno. Devuelve si se pudo entregar.
        """
        async with self._lock:
            room = self._rooms.get(channel_id)
            peer = room.peers.get(member_id) if room is not None else None

        if peer is None or peer.send is None:
            return False
        return await _safe_send(peer, message)

    async def broadcast(
        self, channel_id: str, message: dict[str, object], *, exclude: str | None = None
    ) -> None:
        """Entrega un mensaje a todos en la sala, con un excluido opcional.

        Se usa para anuncios de sala: entró alguien, salió alguien, alguien
        cambió el micrófono. `exclude` evita eco —no tiene sentido avisarle a
        quien acaba de entrar que entró—.
        """
        async with self._lock:
            room = self._rooms.get(channel_id)
            targets = (
                [p for mid, p in room.peers.items() if mid != exclude] if room is not None else []
            )

        for peer in targets:
            await _safe_send(peer, message)

    def snapshot(self, channel_id: str) -> list[dict[str, object]]:
        """Quiénes están en la sala, sin abrir nada. Para la consulta REST."""
        room = self._rooms.get(channel_id)
        if room is None:
            return []
        return [peer.public() for peer in room.peers.values()]

    def count(self, channel_id: str) -> int:
        """Cuántos participantes tiene la sala ahora mismo."""
        room = self._rooms.get(channel_id)
        return len(room.peers) if room is not None else 0

    async def reset(self) -> None:
        """Vacía todas las salas. Solo para tests: garantiza aislamiento."""
        async with self._lock:
            self._rooms.clear()


async def _safe_send(peer: Peer, message: dict[str, object]) -> bool:
    """Envía a un peer y se come el error si la conexión ya está muerta.

    Un participante con la conexión a medio cerrar no debe tumbar el anuncio
    para los demás: se registra y se sigue. La limpieza de la sala la hace el
    `finally` del endpoint, que es quien sabe que la conexión se cayó.
    """
    if peer.send is None:
        return False
    try:
        await peer.send(message)
    except Exception:
        logger.debug("no se pudo enviar a %s; conexión probablemente cerrada", peer.member_id)
        return False
    return True


def parse_signal(raw: str) -> dict[str, object] | None:
    """Convierte el texto crudo del WebSocket en un mensaje, o `None` si es basura.

    El cliente manda JSON. Si manda cualquier otra cosa —un frame corrupto, un
    ping mal formado— se descarta en silencio: el señalizador no adivina, y una
    llamada no se tiene que caer por un mensaje inválido.
    """
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def message_kind(message: dict[str, object]) -> str | None:
    """El `type` del mensaje, si existe y es texto. Si no, `None`."""
    kind = message.get("type")
    return kind if isinstance(kind, str) else None


def is_forwardable(kind: str) -> bool:
    """Si el mensaje es de los que se reenvían entre pares sin interpretar."""
    return kind in _FORWARDED


#: El gestor del proceso. Un singleton, como el engine de base: se crea al
#: importar y vive con el proceso.
call_manager = CallManager()

"""Tests de la señalización WebRTC nativa.

Dos niveles:

- **Gestor** (`CallManager`): la lógica de sala, sin HTTP. Se testea con
  conexiones falsas que solo registran lo que reciben, así se puede afirmar
  sobre los mensajes sin abrir un socket.
- **Endpoint** (WebSocket real): dos pares conectados de verdad contra un
  `TestClient`. La verificación de identidad se reemplaza, porque tocaría la
  base y acá lo que se prueba es el enrutado, no la autenticación.

El audio y el vídeo no se prueban: no pasan por el servidor. Lo que se prueba
es que el servidor presenta a los pares y les pasa los mensajes.
"""

from __future__ import annotations

import uuid

import pytest

from apps.servers.calls import CallManager, Peer

# ─── Helpers ──────────────────────────────────────────────────────────────────


class RecordingSend:
    """Un `send` falso: guarda los mensajes en vez de escribirlos en un socket."""

    def __init__(self) -> None:
        self.received: list[dict[str, object]] = []

    async def __call__(self, message: dict[str, object]) -> None:
        self.received.append(message)

    @property
    def last(self) -> dict[str, object]:
        return self.received[-1]

    @property
    def types(self) -> list[object]:
        return [m.get("type") for m in self.received]


async def _peer(member_id: str, **kwargs: object) -> tuple[Peer, RecordingSend]:
    send = RecordingSend()
    peer = Peer(
        member_id=member_id,
        nickname=member_id,
        display_name=member_id,
        send=send,
        **kwargs,  # type: ignore[arg-type]
    )
    return peer, send


# ─── Gestor: entrar y salir ────────────────────────────────────────────────────


async def test_join_devuelve_quien_ya_estaba() -> None:
    manager = CallManager()
    room = "chan-1"

    ana, _ = await _peer("ana")
    primero = await manager.join(room, ana)
    assert primero == []  # estaba vacía

    beto, _ = await _peer("beto")
    segundo = await manager.join(room, beto)
    assert [p.member_id for p in segundo] == ["ana"]  # beto ve a ana

    assert manager.count(room) == 2


async def test_leave_borra_la_sala_cuando_queda_vacia() -> None:
    manager = CallManager()
    ana, _ = await _peer("ana")
    await manager.join("c", ana)

    restantes = await manager.leave("c", "ana")
    assert restantes == []
    assert manager.count("c") == 0  # la sala se borró, no quedó colgada
    assert manager.snapshot("c") == []


async def test_leave_de_un_peer_que_no_esta_no_rompe() -> None:
    manager = CallManager()
    assert await manager.leave("inexistente", "fantasma") == []


# ─── Gestor: enrutado ──────────────────────────────────────────────────────────


async def test_broadcast_llega_a_todos_menos_al_excluido() -> None:
    manager = CallManager()
    peer_a, send_a = await _peer("a")
    peer_b, send_b = await _peer("b")
    peer_c, _ = await _peer("c")
    await manager.join("r", peer_a)
    await manager.join("r", peer_b)
    await manager.join("r", peer_c)
    send_a.received.clear()
    send_b.received.clear()

    await manager.broadcast("r", {"type": "peer-left", "member_id": "c"}, exclude="c")

    assert send_a.types == ["peer-left"]
    assert send_b.types == ["peer-left"]


async def test_send_to_entrega_a_uno_solo() -> None:
    manager = CallManager()
    peer_a, send_a = await _peer("a")
    peer_b, send_b = await _peer("b")
    await manager.join("r", peer_a)
    await manager.join("r", peer_b)
    send_b.received.clear()

    ok = await manager.send_to("r", "b", {"type": "offer", "from": "a", "payload": {"sdp": 1}})

    assert ok is True
    assert send_b.last == {"type": "offer", "from": "a", "payload": {"sdp": 1}}
    assert "offer" not in send_a.types  # no se filtra a quien no le toca


async def test_send_a_peer_inexistente_devuelve_false() -> None:
    manager = CallManager()
    peer_a, _ = await _peer("a")
    await manager.join("r", peer_a)
    assert await manager.send_to("r", "no-esta", {"type": "ice"}) is False


# ─── Gestor: estado de micrófono/cámara ────────────────────────────────────────


async def test_set_state_actualiza_y_devuelve_el_peer() -> None:
    manager = CallManager()
    peer_a, _ = await _peer("a", mic_on=True, cam_on=False)
    await manager.join("r", peer_a)

    actualizado = await manager.set_state("r", "a", mic=False, cam=True)
    assert actualizado is not None
    assert actualizado.mic_on is False
    assert actualizado.cam_on is True
    assert manager.snapshot("r")[0]["mic"] is False
    assert manager.snapshot("r")[0]["cam"] is True


async def test_set_state_de_ausente_devuelve_none() -> None:
    manager = CallManager()
    assert await manager.set_state("r", "fantasma", mic=False, cam=True) is None


# ─── Endpoint: dos pares de verdad ─────────────────────────────────────────────


@pytest.mark.filterwarnings("ignore::Warning")
def test_dos_pares_se_presentan_y_se_pasan_una_oferta(monkeypatch: pytest.MonkeyPatch) -> None:
    """Dos clientes conectados: el servidor los presenta y reenvía la oferta.

    `resolve_identity` se reemplaza para no tocar la base: lo que se prueba es
    el enrutado del socket, no la autenticación (esa se prueba en su app).
    """
    from starlette.testclient import TestClient

    import apps.servers.api.calls as calls_api
    from core.app import create_app

    server_id = str(uuid.uuid4())
    channel_id = str(uuid.uuid4())
    id_a = "aaaaaaaa-0000-4000-8000-000000000001"
    id_b = "bbbbbbbb-0000-4000-8000-000000000002"
    identidades = {
        "tok-a": calls_api.CallIdentity(member_id=id_a, nickname="ana", display_name="Ana"),
        "tok-b": calls_api.CallIdentity(member_id=id_b, nickname="beto", display_name="Beto"),
    }

    async def fake_resolve(server_id: str, channel_id: str, token: str) -> calls_api.CallIdentity:
        return identidades[token]

    monkeypatch.setattr(calls_api, "resolve_identity", fake_resolve)

    app = create_app()
    url = f"/api/v1/servers/{server_id}/channels/{channel_id}/call"

    with TestClient(app) as client, client.websocket_connect(f"{url}?token=tok-a") as ws_a:
        hola = ws_a.receive_json()
        assert hola["type"] == "welcome"
        assert hola["you"] == id_a
        assert hola["peers"] == []  # ana entra primera, sala vacía

        with client.websocket_connect(f"{url}?token=tok-b") as ws_b:
            hola_b = ws_b.receive_json()
            assert hola_b["type"] == "welcome"
            # A beto le presentan a ana: con eso arma su oferta.
            assert [p["member_id"] for p in hola_b["peers"]] == [id_a]

            # Y a ana le avisan que entró beto.
            aviso = ws_a.receive_json()
            assert aviso == {"type": "peer-joined", "peer": {
                "member_id": id_b, "nickname": "beto", "display_name": "Beto",
                "mic": True, "cam": False,
            }}

            # Ana le ofrece una conexión a beto: el servidor solo reenvía.
            ws_a.send_json({"type": "offer", "to": id_b, "sdp": {"tipo": "offer", "n": 1}})
            recibido = ws_b.receive_json()
            assert recibido == {"type": "offer", "from": id_a, "payload": {"tipo": "offer", "n": 1}}

            # Beto actualiza su micrófono: ana se entera.
            ws_b.send_json({"type": "state", "mic": False, "cam": True})
            estado = ws_a.receive_json()
            assert estado == {"type": "peer-state", "member_id": id_b, "mic": False, "cam": True}

        # beto se fue: a ana le llega el aviso de salida.
        salida = ws_a.receive_json()
        assert salida == {"type": "peer-left", "member_id": id_b}


@pytest.mark.filterwarnings("ignore::Warning")
def test_token_invalido_cierra_el_socket(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sinidentidad válida no hay sala: el socket se cierra con 1008."""
    from starlette.testclient import TestClient

    import apps.servers.api.calls as calls_api
    from core.api.errors import AuthenticationError
    from core.app import create_app

    async def fake_resolve(server_id: str, channel_id: str, token: str) -> calls_api.CallIdentity:
        raise AuthenticationError("El token no es válido.", code="invalid_token")

    monkeypatch.setattr(calls_api, "resolve_identity", fake_resolve)

    app = create_app()
    url = f"/api/v1/servers/{uuid.uuid4()}/channels/{uuid.uuid4()}/call"

    with (
        TestClient(app) as client,
        client.websocket_connect(f"{url}?token=basura") as ws,
        pytest.raises(Exception),  # noqa: B017 — el cierre se manifiesta como excepción
    ):
        ws.receive_json()

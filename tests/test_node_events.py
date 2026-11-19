"""node.state_changed is emitted from the supervisor lifecycle hooks."""

from __future__ import annotations

from common.types import new_id
from core.supervisor import GroupSupervisor
from events.bus import bus, publish_node_state


async def test_node_start_and_stop_emit_state() -> None:
    server_id = new_id()
    sub, _ = bus.subscribe(
        server_id=server_id,
        member_id=new_id(),
        nickname="listener",
        display_name=None,
    )
    supervisor = GroupSupervisor(db_url="sqlite://")

    try:
        await supervisor.start()
        started = sub.queue.get_nowait()
        assert started["type"] == "node.state_changed"
        assert started["server_id"] == str(server_id)
        assert started["data"]["state"] == "up"
        assert started["data"]["reason"] == "node_started"

        await supervisor.stop()
        stopped = sub.queue.get_nowait()
        assert stopped["data"]["state"] == "down"
        assert stopped["data"]["reason"] == "node_stopped"
    finally:
        bus.unsubscribe(sub)


async def test_publish_node_state_without_sockets_is_a_noop() -> None:
    publish_node_state("up", reason="no_subscribers")

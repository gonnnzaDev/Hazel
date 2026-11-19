"""Kafka fan-out unit coverage with fake producer/consumer (no broker needed)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any, ClassVar

import pytest

import events.kafka_bus as kafka_bus
from common.types import new_id
from config.conf import get_settings
from events.bus import bus


class FakeProducer:
    instances: ClassVar[list[FakeProducer]] = []

    def __init__(self, **kwargs: object) -> None:
        self.sent: list[tuple[str, dict[str, Any], bytes]] = []
        self.instances.append(self)

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None

    async def send_and_wait(self, topic: str, *, value: dict[str, Any], key: bytes) -> None:
        self.sent.append((topic, value, key))


class FakeConsumer:
    instances: ClassVar[list[FakeConsumer]] = []

    def __init__(self, *args: object, **kwargs: object) -> None:
        self.messages: list[dict[str, Any]] = []
        self.instances.append(self)

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None

    def __aiter__(self) -> FakeConsumer:
        return self

    async def __anext__(self) -> SimpleNamespace:
        if not self.messages:
            raise StopAsyncIteration
        return SimpleNamespace(value=self.messages.pop(0))


@pytest.fixture
async def fanout(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[kafka_bus.KafkaFanout]:
    FakeProducer.instances.clear()
    FakeConsumer.instances.clear()
    monkeypatch.setattr(kafka_bus, "AIOKafkaProducer", FakeProducer)
    monkeypatch.setattr(kafka_bus, "AIOKafkaConsumer", FakeConsumer)
    settings = get_settings().model_copy(
        update={
            "kafka_fanout_enabled": True,
            "kafka_bootstrap_servers": ["localhost:9092"],
        }
    )
    instance = kafka_bus.KafkaFanout(settings)
    await instance.start()
    try:
        yield instance
    finally:
        await instance.stop()


async def test_publish_sends_to_kafka(fanout: kafka_bus.KafkaFanout) -> None:
    server_id = new_id()
    event = {"type": "message.created", "server_id": str(server_id), "data": {}}

    await fanout.publish(event)

    producer = FakeProducer.instances[-1]
    assert len(producer.sent) == 1
    topic, payload, key = producer.sent[0]
    assert topic == fanout._topic
    assert payload["event"] == event
    assert key == str(server_id).encode()


async def test_consumer_delivers_remote_event_and_skips_own(
    fanout: kafka_bus.KafkaFanout,
) -> None:
    server_id = new_id()
    sub, _ = bus.subscribe(
        server_id=server_id,
        member_id=new_id(),
        nickname="listener",
        display_name=None,
    )
    consumer = FakeConsumer.instances[-1]
    own_event = {"type": "message.created", "server_id": str(server_id), "data": {"n": 1}}
    remote_event = {"type": "message.created", "server_id": str(server_id), "data": {"n": 2}}
    consumer.messages.extend(
        [
            {"instance": fanout._instance_id, "event": own_event},
            {"instance": "other-process", "event": remote_event},
        ]
    )

    try:
        await fanout._consume()
        delivered = sub.queue.get_nowait()
        assert delivered == remote_event
        assert sub.queue.empty()
    finally:
        bus.unsubscribe(sub)


async def test_disabled_fanout_is_a_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeProducer.instances.clear()
    monkeypatch.setattr(kafka_bus, "AIOKafkaProducer", FakeProducer)
    monkeypatch.setattr(kafka_bus, "AIOKafkaConsumer", FakeConsumer)
    settings = get_settings().model_copy(update={"kafka_fanout_enabled": False})
    instance = kafka_bus.KafkaFanout(settings)

    await instance.start()
    assert instance.state == "disabled"
    await instance.publish({"type": "x", "server_id": str(new_id())})
    assert FakeProducer.instances == []

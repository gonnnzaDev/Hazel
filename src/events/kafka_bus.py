"""Cross-process fan-out for realtime events.

The in-process bus still delivers to local sockets. This module mirrors every
committed event onto Kafka and consumes the topic in every Hazel process, so a
socket connected to the node sees events produced by a group process (and vice
versa). Each process uses its own consumer group: every process gets a copy.
Messages produced by this process are skipped on consume to avoid an echo.

Delivery is at-least-once and there is no replay for sockets that were offline
when the event was published, matching the in-process bus contract.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid
from typing import Any

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer

from config.conf import Settings, get_settings
from events.bus import bus

logger = logging.getLogger(__name__)


class KafkaFanout:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._topic = self._settings.kafka_topic("events")
        self._instance_id = f"{self._settings.kafka_client_id_resolved}-{uuid.uuid4().hex[:8]}"
        self._producer: AIOKafkaProducer | None = None
        self._consumer: AIOKafkaConsumer | None = None
        self._task: asyncio.Task[None] | None = None
        self._state = "stopped"

    @property
    def state(self) -> str:
        return self._state

    async def start(self) -> None:
        if not self._settings.kafka_fanout_enabled:
            self._state = "disabled"
            return

        try:
            self._producer = AIOKafkaProducer(
                bootstrap_servers=list(self._settings.kafka_bootstrap_servers),
                client_id=self._instance_id,
                value_serializer=lambda value: json.dumps(value).encode("utf-8"),
            )
            self._consumer = AIOKafkaConsumer(
                self._topic,
                bootstrap_servers=list(self._settings.kafka_bootstrap_servers),
                client_id=self._instance_id,
                group_id=self._instance_id,
                auto_offset_reset="latest",
                enable_auto_commit=True,
                value_deserializer=lambda value: json.loads(value.decode("utf-8")),
            )
            await self._producer.start()
            await self._consumer.start()
            self._task = asyncio.create_task(self._consume(), name="kafka-fanout")
            self._state = "ok"
            logger.info("kafka fanout on %s as %s", self._topic, self._instance_id)
        except Exception:
            logger.exception("kafka fanout could not start; continuing with the local bus only")
            self._state = "error"
            await self._close_clients()

    async def publish(self, event: dict[str, Any]) -> None:
        if self._state != "ok" or self._producer is None:
            return
        payload = {"instance": self._instance_id, "event": event}
        key = str(event.get("server_id", "")).encode("utf-8")
        await self._producer.send_and_wait(self._topic, value=payload, key=key)

    async def _consume(self) -> None:
        assert self._consumer is not None
        try:
            async for message in self._consumer:
                payload = message.value
                if not isinstance(payload, dict) or payload.get("instance") == self._instance_id:
                    continue
                event = payload.get("event")
                if isinstance(event, dict):
                    self._deliver(event)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("kafka fanout consumer stopped")

    @staticmethod
    def _deliver(event: dict[str, Any]) -> None:
        try:
            server_id = uuid.UUID(str(event["server_id"]))
            raw_channel = event.get("channel_id")
            channel_id = uuid.UUID(str(raw_channel)) if raw_channel else None
        except KeyError, ValueError, TypeError:
            logger.warning("dropping malformed event from kafka: %r", event)
            return
        bus.publish(server_id=server_id, channel_id=channel_id, event=event)

    async def _close_clients(self) -> None:
        if self._consumer is not None:
            await self._consumer.stop()
            self._consumer = None
        if self._producer is not None:
            await self._producer.stop()
            self._producer = None

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        await self._close_clients()
        self._state = "stopped"


_fanout: KafkaFanout | None = None


def get_kafka_fanout(settings: Settings | None = None) -> KafkaFanout:
    global _fanout
    if _fanout is None:
        _fanout = KafkaFanout(settings)
    return _fanout

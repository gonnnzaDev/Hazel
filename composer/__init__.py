"""Hazel composer — the only orchestrator.

Python is not the application anymore: the node is Rust. Python is only the
``composer``: it prepares the environment, builds the binary and composes the
services (PostgreSQL, Kafka and the node) with the Docker CLI.

Standard library only. Run it with::

    python -m composer --help
"""

__version__ = "0.1.0"

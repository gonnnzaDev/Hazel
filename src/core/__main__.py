"""Run node or group via `python -m core`; bare command starts the node.

Module form avoids `uv run` script spawn failures.
"""

from core.run import main

if __name__ == "__main__":
    main()

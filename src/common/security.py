from __future__ import annotations

import hashlib
import hmac
import os

PBKDF2_ITERATIONS = 100_000
_SALT_BYTES = 16
_ALGORITHM = "pbkdf2_sha256"


def hash_password(password: str | None) -> str | None:
    """Return a salted PBKDF2 hash, or None for a missing password."""
    if password is None:
        return None
    salt = os.urandom(_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"{_ALGORITHM}${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str | None, hashed: str | None) -> bool:
    """Verify a password against a stored hash (supports legacy SHA-256)."""
    if hashed is None:
        return password is None
    if password is None:
        return False
    if "$" not in hashed:
        return hmac.compare_digest(hashlib.sha256(password.encode("utf-8")).hexdigest(), hashed)
    try:
        algorithm, iterations, salt_hex, digest_hex = hashed.split("$", 3)
    except ValueError:
        return False
    if algorithm != _ALGORITHM:
        return False
    try:
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt_hex),
            int(iterations),
        )
    except ValueError, TypeError:
        return False
    return hmac.compare_digest(digest.hex(), digest_hex)

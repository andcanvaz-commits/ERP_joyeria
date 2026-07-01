"""Rate limiting sencillo en memoria (ventana deslizante).

Protege endpoints sensibles como el login contra fuerza bruta.

Claves de conteo:
- Por IP: cualquier combinacion de usuarios/mayusculas ("Admin", "aDmin",
  "admin"...) desde la misma IP cae en el mismo contador. Cambiar el nombre de
  usuario NO evade el limite.
- Por username: frena intentos distribuidos (muchas IPs) contra una sola cuenta.

Nota: es en memoria y por proceso. Para varios workers/instancias usar Redis
(settings.redis_url) como backend compartido. Aqui basta para un proceso.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Any


def get_client_ip(request: Any) -> str:
    """IP real del cliente.

    Tras un reverse proxy (nginx) usa el primer valor de ``X-Forwarded-For``.
    Sin proxy usa la IP directa de la conexion.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    client = getattr(request, "client", None)
    return client.host if client else "unknown"


class SlidingWindowRateLimiter:
    def __init__(self, max_attempts: int, window_seconds: int) -> None:
        self._max = max_attempts
        self._window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _now(self) -> float:
        return time.monotonic()

    def check(self, key: str) -> tuple[bool, int]:
        """Registra un intento para ``key``.

        Devuelve ``(permitido, segundos_retry)``. Cuando se supera el limite,
        ``permitido`` es False y ``segundos_retry`` indica cuanto esperar.
        """
        now = self._now()
        with self._lock:
            bucket = self._hits[key]
            cutoff = now - self._window
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= self._max:
                retry_after = int(bucket[0] + self._window - now) + 1
                return False, max(retry_after, 1)
            bucket.append(now)
            if not bucket and key in self._hits:
                del self._hits[key]
            return True, 0

    def reset(self, key: str) -> None:
        """Limpia el contador de una clave (p.ej. tras login exitoso)."""
        with self._lock:
            self._hits.pop(key, None)

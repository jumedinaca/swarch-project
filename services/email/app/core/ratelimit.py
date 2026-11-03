import math
import time
from collections import deque


class SlidingWindowRateLimiter:
    """
    Limitador de ventana deslizante en memoria.
    Se usa para el límite global de envíos SMTP (por defecto 100 correos/minuto).
    """

    def __init__(self, limit: int, window_seconds: float = 60.0, clock=time.monotonic):
        self.limit = limit
        self.window_seconds = window_seconds
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}

    def try_acquire(self, key: str = "global") -> float | None:
        """
        Registra un envío si hay cupo disponible.
        Devuelve None si se permite, o los segundos restantes de espera si se agotó.
        """
        if self.limit <= 0:
            return self.window_seconds
        now = self._clock()
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] >= self.window_seconds:
            hits.popleft()
        if len(hits) >= self.limit:
            wait = self.window_seconds - (now - hits[0])
            return max(0.01, round(wait, 3))
        hits.append(now)
        return None

    def retry_after_seconds(self, key: str = "global") -> int:
        now = self._clock()
        hits = self._hits.get(key)
        if not hits:
            return 1
        return max(1, math.ceil(self.window_seconds - (now - hits[0])))

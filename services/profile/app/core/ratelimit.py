import math
import time
import uuid
from collections import deque


class UploadRateLimiter:
    """
    Ventana deslizante en memoria por usuario. Suficiente para una sola
    instancia del servicio; con varias réplicas habría que moverlo a Redis.
    """

    def __init__(self, limit: int, window_seconds: int = 3600, clock=time.monotonic):
        self.limit = limit
        self.window_seconds = window_seconds
        self._clock = clock
        self._hits: dict[uuid.UUID, deque[float]] = {}

    def try_acquire(self, user_id: uuid.UUID) -> int | None:
        """Registra un intento. Devuelve None si se permite, o los segundos a esperar."""
        now = self._clock()
        hits = self._hits.setdefault(user_id, deque())
        while hits and now - hits[0] >= self.window_seconds:
            hits.popleft()
        if len(hits) >= self.limit:
            return max(1, math.ceil(self.window_seconds - (now - hits[0])))
        hits.append(now)
        return None

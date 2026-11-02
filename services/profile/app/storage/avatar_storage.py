import asyncio
import io
import logging
from typing import Protocol

import urllib3
from minio import Minio
from minio.error import S3Error

logger = logging.getLogger(__name__)

CONNECT_TIMEOUT_SECONDS = 3
READ_TIMEOUT_SECONDS = 15


class AvatarStorage(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...

    async def get(self, key: str) -> bytes | None: ...

    async def delete(self, key: str) -> None: ...

    async def ping(self) -> bool: ...


class MinioAvatarStorage:
    """
    Bucket privado en MinIO. Los avatares se sirven a través del servicio
    (GET /profiles/avatars/{key}), así que el bucket nunca se expone.
    El SDK de MinIO es síncrono: cada llamada corre en un hilo aparte.
    """

    def __init__(self, endpoint: str, access_key: str, secret_key: str, bucket: str, secure: bool = False):
        self.bucket = bucket
        # El cliente por defecto espera hasta 5 min por conexión y reintenta 5
        # veces: con MinIO caído, una petición quedaría colgada demasiado tiempo.
        http_client = urllib3.PoolManager(
            timeout=urllib3.Timeout(connect=CONNECT_TIMEOUT_SECONDS, read=READ_TIMEOUT_SECONDS),
            retries=urllib3.Retry(total=2, backoff_factor=0.2, status_forcelist=[500, 502, 503, 504]),
            maxsize=10,
        )
        self._client = Minio(
            endpoint, access_key=access_key, secret_key=secret_key, secure=secure, http_client=http_client
        )
        self._bucket_ready = False

    async def initialize(self) -> None:
        await asyncio.to_thread(self._ensure_bucket)

    def _ensure_bucket(self) -> None:
        if self._bucket_ready:
            return
        if not self._client.bucket_exists(self.bucket):
            self._client.make_bucket(self.bucket)
        self._bucket_ready = True

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        def _put() -> None:
            # Si MinIO no estaba listo al arrancar, el bucket se crea en la primera subida.
            self._ensure_bucket()
            self._client.put_object(self.bucket, key, io.BytesIO(data), len(data), content_type=content_type)

        await asyncio.to_thread(_put)

    async def get(self, key: str) -> bytes | None:
        def _get() -> bytes | None:
            try:
                response = self._client.get_object(self.bucket, key)
            except S3Error as exc:
                if exc.code in ("NoSuchKey", "NoSuchBucket"):
                    return None
                raise
            try:
                return response.read()
            finally:
                response.close()
                response.release_conn()

        return await asyncio.to_thread(_get)

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self._client.remove_object, self.bucket, key)

    async def ping(self) -> bool:
        try:
            await asyncio.to_thread(self._client.bucket_exists, self.bucket)
            return True
        except Exception:
            logger.warning("MinIO no responde.", exc_info=True)
            return False

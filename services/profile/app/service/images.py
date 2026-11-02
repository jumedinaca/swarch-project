import io

from PIL import Image, ImageOps, UnidentifiedImageError

ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
MIN_SIDE = 64
MAX_SIDE = 4096
AVATAR_SIDE = 512
WEBP_QUALITY = 85


class ImageRejected(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def _unsupported() -> ImageRejected:
    return ImageRejected(415, "unsupported_media_type", "Formato no soportado. Usa una imagen JPEG, PNG o WebP.")


def _looks_like_svg(data: bytes) -> bool:
    head = data[:512].lstrip().lower()
    return head.startswith(b"<?xml") or head.startswith(b"<svg") or b"<svg" in head


def process_avatar(data: bytes) -> bytes:
    """
    Valida la imagen por su contenido real (no por el Content-Type del cliente)
    y la normaliza: orientación corregida, sin metadatos, recorte cuadrado
    centrado, 512x512 y WebP calidad 85. Es trabajo de CPU: llamar en un hilo.
    """
    try:
        with Image.open(io.BytesIO(data)) as img:
            if img.format not in ALLOWED_FORMATS:
                raise _unsupported()
            if getattr(img, "is_animated", False):
                raise ImageRejected(415, "unsupported_media_type", "No se permiten imágenes animadas.")

            # Image.open solo lee la cabecera: se valida el tamaño antes de decodificar.
            width, height = img.size
            if max(width, height) > MAX_SIDE or min(width, height) < MIN_SIDE:
                raise ImageRejected(
                    422,
                    "invalid_image",
                    f"La imagen debe medir entre {MIN_SIDE}x{MIN_SIDE} y {MAX_SIDE}x{MAX_SIDE} píxeles.",
                )

            img.load()
            oriented = ImageOps.exif_transpose(img)
            has_alpha = oriented.mode in ("RGBA", "LA", "PA") or (
                oriented.mode == "P" and "transparency" in oriented.info
            )
            converted = oriented.convert("RGBA" if has_alpha else "RGB")
            square = ImageOps.fit(converted, (AVATAR_SIDE, AVATAR_SIDE), method=Image.Resampling.LANCZOS)
            # Sin EXIF, ICC ni XMP en el archivo resultante.
            square.info.clear()

            out = io.BytesIO()
            square.save(out, format="WEBP", quality=WEBP_QUALITY)
            return out.getvalue()
    except ImageRejected:
        raise
    except UnidentifiedImageError as exc:
        if _looks_like_svg(data):
            raise _unsupported() from exc
        raise ImageRejected(422, "invalid_image", "El archivo no es una imagen válida.") from exc
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError) as exc:
        raise ImageRejected(422, "invalid_image", "El archivo no es una imagen válida.") from exc

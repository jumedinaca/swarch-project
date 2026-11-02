import hashlib
import re
import uuid

# Misma paleta que usaba auth antes de que el color pasara a profile, para que
# los autores conserven el aspecto que ya tenían en el frontend.
PALETTE = ("#2AC769", "#1EA4E8", "#F5A623", "#E84393", "#9B51E0")

COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")


def default_color(user_id: uuid.UUID) -> str:
    """Color estable: el mismo userId siempre produce el mismo color."""
    digest = hashlib.sha256(str(user_id).encode()).digest()
    return PALETTE[int.from_bytes(digest[:8], "big") % len(PALETTE)]

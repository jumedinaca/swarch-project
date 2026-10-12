from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class FriendshipStatus(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"


@dataclass(frozen=True, slots=True)
class Friendship:
    id: str                 # ObjectId de la amistad en MongoDB
    user_a: str             # UUID del usuario
    user_b: str            # UUID del otro usuario
    status: FriendshipStatus
    requested_by: str       # UUID de quien envió la solicitud
    created_at: datetime
    updated_at: datetime
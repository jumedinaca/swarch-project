import re
import unicodedata
from dataclasses import dataclass

ZERO_WIDTH = re.compile("[​-‏‪-‮⁠-⁤﻿]")
WHITESPACE = re.compile(r"\s+")

# Leetspeak básico. Solo se aplica a la variante `folded`.
LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"})


@dataclass(frozen=True)
class NormalizedText:
    original: str
    # Minúsculas, NFKC, sin tildes ni ancho cero y con espacios colapsados.
    plain: str
    # `plain` con el leetspeak traducido (p3rr0 -> perro).
    folded: str


def _strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(c for c in decomposed if unicodedata.category(c) != "Mn")


def normalize(text: str, max_chars: int = 2000) -> NormalizedText:
    original = text[:max_chars]
    plain = unicodedata.normalize("NFKC", original)
    plain = ZERO_WIDTH.sub("", plain).lower()
    plain = _strip_accents(plain)
    plain = WHITESPACE.sub(" ", plain).strip()
    return NormalizedText(original=original, plain=plain, folded=plain.translate(LEET))

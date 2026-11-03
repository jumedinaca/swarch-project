import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from app.service.normalize import NormalizedText

URL = re.compile(r"(https?://|www\.)\S+|\b[\w-]+\.(com|co|net|org|io|ly|me|xyz)(/\S*)?\b")
CHAR_RUN = r"(.)\1{%d,}"
WORD_RUN = r"\b(\w+)\b(?:\s+\1\b){%d,}"


@dataclass(frozen=True)
class RuleResult:
    block_reasons: list[str] = field(default_factory=list)
    warn_reasons: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class _PatternRule:
    code: str
    variant: str
    patterns: list[re.Pattern]

    def matches(self, text: NormalizedText) -> bool:
        target = getattr(text, self.variant)
        return any(p.search(target) for p in self.patterns)


class RuleEngine:
    """Reglas duras independientes del clasificador (rules/moderation.yaml)."""

    def __init__(self, config: dict):
        self.version: str = str(config["version"])
        self._block = [
            _PatternRule(
                code,
                spec.get("target", "folded"),
                # Límites de palabra para no marcar subcadenas (README_P2 §8).
                [re.compile(rf"(?<!\w)(?:{p})(?!\w)") for p in spec.get("patterns") or []],
            )
            for code, spec in (config.get("block") or {}).items()
        ]
        warn = config.get("warn") or {}
        self._max_links = warn.get("SPAM_LINKS", {}).get("max_links")
        repeated = warn.get("REPEATED_CONTENT", {})
        self._char_run = re.compile(CHAR_RUN % (repeated["max_char_run"] - 1)) if repeated else None
        self._word_run = re.compile(WORD_RUN % (repeated["max_word_run"] - 1)) if repeated else None
        caps = warn.get("EXCESSIVE_CAPS", {})
        self._caps_min_letters = caps.get("min_letters")
        self._caps_max_ratio = caps.get("max_ratio")

    @classmethod
    def from_file(cls, path: Path) -> "RuleEngine":
        with open(path, encoding="utf-8") as fh:
            return cls(yaml.safe_load(fh))

    def evaluate(self, text: NormalizedText) -> RuleResult:
        block = [rule.code for rule in self._block if rule.matches(text)]
        warn = []
        if self._max_links is not None and len(URL.findall(text.plain)) > self._max_links:
            warn.append("SPAM_LINKS")
        if (self._char_run and self._char_run.search(text.plain)) or (
            self._word_run and self._word_run.search(text.plain)
        ):
            warn.append("REPEATED_CONTENT")
        if self._caps_min_letters is not None and self._is_shouting(text.original):
            warn.append("EXCESSIVE_CAPS")
        return RuleResult(block_reasons=block, warn_reasons=warn)

    def _is_shouting(self, original: str) -> bool:
        letters = [c for c in original if c.isalpha()]
        if len(letters) < self._caps_min_letters:
            return False
        upper = sum(1 for c in letters if c.isupper())
        return upper / len(letters) >= self._caps_max_ratio

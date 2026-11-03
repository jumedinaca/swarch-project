import pytest

from app.core.config import DEFAULT_RULES_PATH
from app.service.normalize import normalize
from app.service.rules import RuleEngine


@pytest.fixture(scope="module")
def rules() -> RuleEngine:
    return RuleEngine.from_file(DEFAULT_RULES_PATH)


def evaluate(rules: RuleEngine, text: str):
    return rules.evaluate(normalize(text))


def test_normalize_strips_accents_zero_width_and_leetspeak():
    text = normalize("  ¡Te VOY a​ ap4ñal4r!   ")
    assert text.plain == "¡te voy a ap4nal4r!"
    assert text.folded == "¡te voy a apanalar!"


@pytest.mark.parametrize(
    "content",
    [
        "Te voy a matar",
        "t3 v0y 4 m4t4r",
        "Sé dónde vives",
        "voy a chuzarte mañana",
    ],
)
def test_threats_block(rules, content):
    assert "THREAT" in evaluate(rules, content).block_reasons


@pytest.mark.parametrize(
    "content",
    [
        "llámalo al 310 555 1234",
        "escríbele a ana.perez@correo.com",
        "vive en la calle 45 # 12-30",
        "cra 7 n 32-16 apto 301",
    ],
)
def test_doxxing_blocks(rules, content):
    assert "DOXXING" in evaluate(rules, content).block_reasons


@pytest.mark.parametrize(
    "content",
    [
        "Hola desde la prueba de integracion",
        "esa vaina está brutal",
        "nos vemos en la estación de la calle 45",
        "mi equipo me mató de la risa",
    ],
)
def test_benign_messages_pass(rules, content):
    result = evaluate(rules, content)
    assert result.block_reasons == []
    assert result.warn_reasons == []


def test_link_spam_warns(rules):
    result = evaluate(rules, "mira https://a.co https://b.co y www.c.com")
    assert result.warn_reasons == ["SPAM_LINKS"]


def test_two_links_are_fine(rules):
    assert evaluate(rules, "https://a.co y https://b.co").warn_reasons == []


def test_repeated_content_warns(rules):
    assert "REPEATED_CONTENT" in evaluate(rules, "holaaaaaaaaaaaa").warn_reasons
    assert "REPEATED_CONTENT" in evaluate(rules, "compra compra compra compra compra").warn_reasons


def test_shouting_warns(rules):
    assert "EXCESSIVE_CAPS" in evaluate(rules, "ESTO ES UNA ESTAFA NO LO COMPREN").warn_reasons
    assert evaluate(rules, "OK").warn_reasons == []

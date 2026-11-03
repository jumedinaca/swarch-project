import pytest
from pydantic import ValidationError

from app.schema.email_schema import InternalEmailCreateRequest
from app.service.template_renderer import TemplateNotRegisteredError, TemplateRenderer


def test_welcome_renders_spanish_html_and_plain_text():
    renderer = TemplateRenderer()
    rendered = renderer.render("welcome", "¡Bienvenido a GeoPicto, Explorador!", {"username": "Explorador"})

    assert "¡Hola, Explorador!" in rendered.html_body
    assert "max-width: 600px" in rendered.html_body
    assert "GeoPicto" in rendered.html_body
    assert "unsubscribe" not in rendered.html_body.lower()
    assert "darse de baja" not in rendered.html_body.lower()

    assert "¡Hola, Explorador!" in rendered.text_body
    assert "GeoPicto" in rendered.text_body


def test_generic_renders_with_and_without_cta():
    renderer = TemplateRenderer()
    with_cta = renderer.render(
        "generic",
        "Novedades en GeoPicto",
        {
            "title": "Nueva actualización",
            "body": "Línea 1\nLínea 2",
            "ctaUrl": "https://geopicto.org/explorar",
            "ctaLabel": "Explorar mapa",
        },
    )
    assert "Nueva actualización" in with_cta.html_body
    assert "Línea 1<br>\nLínea 2" in with_cta.html_body
    assert 'href="https://geopicto.org/explorar"' in with_cta.html_body
    assert "Explorar mapa" in with_cta.html_body
    assert "Explorar mapa: https://geopicto.org/explorar" in with_cta.text_body

    without_cta = renderer.render(
        "generic",
        "Aviso",
        {"title": "Mantenimiento", "body": "Volveremos pronto."},
    )
    assert "href=" not in without_cta.html_body
    assert "Volveremos pronto." in without_cta.text_body


def test_autoescape_blocks_arbitrary_html_injection():
    renderer = TemplateRenderer()
    xss = "<script>alert('xss')</script><img src=x onerror=alert(1)> & 'comillas'"
    rendered = renderer.render(
        "generic",
        "Prueba de seguridad",
        {"title": xss, "body": f"Hola {xss}"},
    )

    assert "<script>" not in rendered.html_body
    assert "<img" not in rendered.html_body
    assert "&lt;script&gt;" in rendered.html_body
    # En texto plano no deben quedar entidades HTML escapadas.
    assert "&lt;script&gt;" not in rendered.text_body
    assert "<script>alert('xss')</script>" in rendered.text_body


def test_unregistered_templates_are_rejected():
    renderer = TemplateRenderer()
    for unreg in ("level-up", "moderation-warning", "moderation-blocked", "custom-html"):
        with pytest.raises(TemplateNotRegisteredError):
            renderer.render(unreg, "Asunto", {"username": "Geo"})


@pytest.mark.parametrize(
    "bad_url",
    [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "ftp://geopicto.org/file",
        "/ruta/relativa",
        "geopicto.org/sin-esquema",
    ],
)
def test_cta_url_only_allows_absolute_http_https(bad_url: str):
    with pytest.raises(ValidationError):
        InternalEmailCreateRequest.model_validate(
            {
                "to": "explorador@geochat.org",
                "template": "generic",
                "subject": "Enlace inválido",
                "variables": {"title": "Hola", "body": "Mensaje", "ctaUrl": bad_url},
            }
        )


def test_subject_and_recipient_limits_enforced():
    with pytest.raises(ValidationError):
        InternalEmailCreateRequest.model_validate(
            {
                "to": "explorador@geochat.org",
                "template": "generic",
                "subject": "x" * 201,
                "variables": {"title": "Hola", "body": "Mensaje"},
            }
        )

    long_local = "a" * 315 + "@geochat.org"
    assert len(long_local) > 320
    with pytest.raises(ValidationError):
        InternalEmailCreateRequest.model_validate(
            {
                "to": long_local,
                "template": "welcome",
                "variables": {"username": "Geo"},
            }
        )

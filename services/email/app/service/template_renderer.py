from dataclasses import dataclass
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, StrictUndefined
from markupsafe import Markup, escape

from app.schema.email_schema import REGISTERED_TEMPLATES, validate_template_variables

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"


@dataclass(frozen=True)
class RenderedEmail:
    html_body: str
    text_body: str


def _nl2br_safe(value: Any) -> Markup:
    """Escapa cada línea contra XSS y convierte saltos de línea en `<br>`."""
    text = str(value or "").replace("\r\n", "\n")
    escaped_lines = [escape(line) for line in text.split("\n")]
    return Markup("<br>\n").join(escaped_lines)


class TemplateNotRegisteredError(ValueError):
    pass


class TemplateRenderer:
    """
    Renderizador de plantillas con catálogo cerrado (`welcome`, `generic`).
    Aplica autoescape obligatorio sobre `.html.j2` y mantiene texto plano limpio en `.txt.j2`.
    """

    def __init__(self, templates_dir: Path = TEMPLATES_DIR):
        self._env = Environment(
            loader=FileSystemLoader(str(templates_dir), encoding="utf-8"),
            autoescape=lambda name: bool(name and name.endswith(".html.j2")),
            undefined=StrictUndefined,
            trim_blocks=True,
            lstrip_blocks=True,
        )
        self._env.filters["nl2br"] = _nl2br_safe

    def render(self, template: str, subject: str, variables: dict[str, Any]) -> RenderedEmail:
        if template not in REGISTERED_TEMPLATES:
            raise TemplateNotRegisteredError(f"La plantilla '{template}' no está registrada.")

        validated_vars = validate_template_variables(template, variables)
        context = {"subject": subject, **validated_vars}

        html_template = self._env.get_template(f"{template}.html.j2")
        text_template = self._env.get_template(f"{template}.txt.j2")

        html_body = html_template.render(**context).strip()
        text_body = text_template.render(**context).strip()

        return RenderedEmail(html_body=html_body, text_body=text_body)

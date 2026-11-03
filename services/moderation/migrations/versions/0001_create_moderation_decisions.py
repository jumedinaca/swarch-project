"""create moderation_decisions

Revision ID: 0001
Revises:
Create Date: 2026-11-02
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "moderation_decisions",
        sa.Column("id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("message_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("decision", sa.String(16), nullable=False),
        sa.Column("confidence", sa.Numeric(5, 4)),
        sa.Column("reasons", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("model_version", sa.String(64)),
        sa.Column("rule_version", sa.String(32), nullable=False),
        sa.Column("degraded", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("latency_ms", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("message_id", "message_version", name="uq_moderation_message_version"),
        sa.CheckConstraint(
            "decision IN ('ALLOW', 'WARN', 'BLOCK', 'REVIEW')", name="ck_moderation_decision"
        ),
    )
    op.create_index(
        "idx_moderation_author_created",
        "moderation_decisions",
        ["author_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("idx_moderation_author_created", table_name="moderation_decisions")
    op.drop_table("moderation_decisions")

"""create email_log

Revision ID: 0001
Revises:
Create Date: 2026-11-02
"""
import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "email_log",
        sa.Column("id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("idempotency_key", sa.String(160), unique=True),
        sa.Column("recipient", sa.String(320), nullable=False),
        sa.Column("template", sa.String(64), nullable=False),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="QUEUED"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("provider_message_id", sa.String(255)),
        sa.Column("last_error", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('QUEUED','SENDING','SENT','FAILED','DLQ')",
            name="ck_email_log_status",
        ),
    )
    op.create_index("idx_email_log_status_created", "email_log", ["status", "created_at"])
    op.create_index("idx_email_log_recipient_created", "email_log", ["recipient", "created_at"])


def downgrade() -> None:
    op.drop_index("idx_email_log_recipient_created", table_name="email_log")
    op.drop_index("idx_email_log_status_created", table_name="email_log")
    op.drop_table("email_log")

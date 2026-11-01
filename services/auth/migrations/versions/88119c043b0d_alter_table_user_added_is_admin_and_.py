"""alter table user (added is_admin and removed color)

Revision ID: 88119c043b0d
Revises: 0001
Create Date: 2026-10-29 05:17:37.421851
"""
import sqlalchemy as sa
from alembic import op


revision = "88119c043b0d"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # server_default para que la migración funcione sobre tablas con filas existentes
    op.add_column(
        "users",
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.drop_column("users", "color")


def downgrade() -> None:
    # Se necesita un valor para las filas existentes antes de quitar el default
    op.add_column(
        "users",
        sa.Column("color", sa.VARCHAR(length=7), nullable=False, server_default="#2AC769"),
    )
    op.alter_column("users", "color", server_default=None)
    op.drop_column("users", "is_admin")

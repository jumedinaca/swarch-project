"""create profiles

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
        "profiles",
        sa.Column("user_id", sa.Uuid(), primary_key=True),
        sa.Column("username", sa.String(50), nullable=False),
        sa.Column("display_name", sa.String(50)),
        sa.Column("about", sa.String(500)),
        sa.Column("color", sa.String(7), nullable=False, server_default="#2AC769"),
        sa.Column("avatar_key", sa.Text()),
        sa.Column("avatar_url", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_profiles_display_name", "profiles", [sa.text("lower(display_name)")])
    op.create_index("idx_profiles_username", "profiles", [sa.text("lower(username)")])


def downgrade() -> None:
    op.drop_index("idx_profiles_username", table_name="profiles")
    op.drop_index("idx_profiles_display_name", table_name="profiles")
    op.drop_table("profiles")

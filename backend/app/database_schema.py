"""Import-safe helpers for creating only application-managed legacy tables."""

from sqlalchemy import MetaData
from sqlalchemy.engine import Engine


def create_legacy_tables(engine: Engine, metadata: MetaData) -> None:
    """Create unmarked tables, rejecting dependencies on migration-managed tables."""
    tables = list(metadata.tables.values())
    managed_tables = {table for table in tables if table.info.get("migration_managed") is True}
    legacy_tables = [table for table in tables if table not in managed_tables]

    for table in legacy_tables:
        for foreign_key in table.foreign_keys:
            referred_table = foreign_key.column.table
            if referred_table in managed_tables:
                raise ValueError(
                    f"Cannot automatically create legacy table {table.fullname!r}: "
                    f"foreign key {foreign_key.name or foreign_key.parent.name!r} "
                    f"depends on migration-managed table {referred_table.fullname!r}. "
                    "Apply its manual migration before creating dependent tables."
                )

    metadata.create_all(engine, tables=legacy_tables)

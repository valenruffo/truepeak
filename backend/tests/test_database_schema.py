"""SQLite tests for guarding private, migration-managed schema tables."""

from __future__ import annotations

import ast
from pathlib import Path

import pytest
from sqlalchemy import Column, ForeignKey, Integer, MetaData, Table, create_engine, inspect

from app.ar_matching.storage_models import LabelReferenceTrack, MusicEmbedding
from app.database_schema import create_legacy_tables


@pytest.fixture
def engine():
    test_engine = create_engine("sqlite://")
    try:
        yield test_engine
    finally:
        test_engine.dispose()


def test_private_storage_tables_are_marked_migration_managed():
    assert LabelReferenceTrack.__table__.info.get("migration_managed") is True
    assert MusicEmbedding.__table__.info.get("migration_managed") is True


def test_helper_excludes_any_marked_table_and_creates_unmarked_legacy_table(engine):
    metadata = MetaData()
    Table("legacy_record", metadata, Column("id", Integer, primary_key=True))
    Table(
        "future_private_record",
        metadata,
        Column("id", Integer, primary_key=True),
        info={"migration_managed": True},
    )

    create_legacy_tables(engine, metadata)

    names = set(inspect(engine).get_table_names())
    assert "legacy_record" in names
    assert "future_private_record" not in names


def test_legacy_foreign_key_parent_and_child_are_created(engine):
    metadata = MetaData()
    Table("legacy_parent", metadata, Column("id", Integer, primary_key=True))
    Table(
        "legacy_child",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("parent_id", ForeignKey("legacy_parent.id"), nullable=False),
    )

    create_legacy_tables(engine, metadata)

    names = set(inspect(engine).get_table_names())
    assert {"legacy_parent", "legacy_child"} <= names


def test_legacy_dependency_on_marked_parent_fails_before_any_ddl(engine):
    metadata = MetaData()
    Table(
        "managed_parent",
        metadata,
        Column("id", Integer, primary_key=True),
        info={"migration_managed": True},
    )
    Table(
        "legacy_child",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("parent_id", ForeignKey("managed_parent.id"), nullable=False),
    )

    with pytest.raises(ValueError, match="legacy_child.*migration-managed table.*managed_parent"):
        create_legacy_tables(engine, metadata)

    assert inspect(engine).get_table_names() == []


def test_empty_and_all_managed_metadata_create_no_tables(engine):
    create_legacy_tables(engine, MetaData())
    assert inspect(engine).get_table_names() == []

    managed_metadata = MetaData()
    Table(
        "managed_only",
        managed_metadata,
        Column("id", Integer, primary_key=True),
        info={"migration_managed": True},
    )
    create_legacy_tables(engine, managed_metadata)
    assert inspect(engine).get_table_names() == []


def test_legacy_table_creation_is_idempotent(engine):
    metadata = MetaData()
    Table("legacy_once", metadata, Column("id", Integer, primary_key=True))

    create_legacy_tables(engine, metadata)
    create_legacy_tables(engine, metadata)

    assert inspect(engine).get_table_names() == ["legacy_once"]


def test_init_db_delegates_schema_creation_without_importing_database_module():
    """AST wiring check only; does not execute startup or connect to PostgreSQL."""
    source_path = Path(__file__).parents[1] / "app" / "database.py"
    module = ast.parse(source_path.read_text(encoding="utf-8"))
    init_db = next(
        node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == "init_db"
    )
    calls = {
        node.func.id if isinstance(node.func, ast.Name) else node.func.attr
        for node in ast.walk(init_db)
        if isinstance(node, ast.Call) and isinstance(node.func, (ast.Name, ast.Attribute))
    }

    assert "create_legacy_tables" in calls
    assert "create_all" not in calls

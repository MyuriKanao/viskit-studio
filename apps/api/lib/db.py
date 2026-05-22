"""SQLAlchemy 2 engine + session factory.

The runtime supports both PostgreSQL and SQLite:

- PostgreSQL remains the production-scale option.
- SQLite is the zero-infra/default local and Docker option.  It stores JSON
  payloads as TEXT and enables foreign keys/WAL on connect.
"""

from __future__ import annotations

import os
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

_engine: Engine | None = None
_SessionLocal = None

_REPO_ROOT = Path(__file__).resolve().parents[3]
_MIGRATION_DIR = _REPO_ROOT / "infra" / "migrations"


def _truthy_env(name: str, *, default: bool = True) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


def _database_url() -> str:
    """Return the configured URL, defaulting to local SQLite.

    Historical examples used ``postgresql://`` while the project depends on
    psycopg v3, whose SQLAlchemy driver name is ``postgresql+psycopg``.  Normalize
    the URL so existing env files keep working.
    """
    raw = os.environ.get("DATABASE_URL", "sqlite:///data/viskit.db")
    if raw.startswith("postgresql://"):
        return "postgresql+psycopg://" + raw.removeprefix("postgresql://")
    return raw


def _sqlite_connect_args(url: str) -> dict[str, Any]:
    parsed = make_url(url)
    if parsed.get_backend_name() != "sqlite":
        return {}
    return {"check_same_thread": False}


def _sqlite_pool_args(url: str) -> dict[str, Any]:
    parsed = make_url(url)
    if parsed.get_backend_name() == "sqlite" and (parsed.database in {None, "", ":memory:"}):
        return {"poolclass": StaticPool}
    return {}


def _configure_sqlite(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        return

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection: Any, _connection_record: Any) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


def _get_engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        url = _database_url()
        parsed = make_url(url)
        is_sqlite = parsed.get_backend_name() == "sqlite"
        _engine = create_engine(
            url,
            pool_pre_ping=not is_sqlite,
            connect_args=_sqlite_connect_args(url),
            **_sqlite_pool_args(url),
        )
        _configure_sqlite(_engine)
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False)
    return _engine


def database_backend() -> str:
    return _get_engine().dialect.name


def is_sqlite(session: Session | None = None) -> bool:
    bind = session.get_bind() if session is not None else _get_engine()
    return bind.dialect.name == "sqlite"


def json_param(session: Session, name: str) -> str:
    """Return a SQL fragment for a bound JSON parameter."""
    return f":{name}" if is_sqlite(session) else f"CAST(:{name} AS JSONB)"


def array_param(session: Session, value: list[str]) -> list[str] | str:
    """Encode a list for PostgreSQL TEXT[] or SQLite TEXT(JSON)."""
    if not is_sqlite(session):
        return value
    import json

    return json.dumps(value, ensure_ascii=False)


def get_session() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a SQLAlchemy session."""
    _get_engine()
    assert _SessionLocal is not None
    session: Session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    """Yield a standalone SQLAlchemy session for background tasks.

    FastAPI request handlers should keep using :func:`get_session`; this helper
    exists for in-process workers that need the same commit/rollback contract
    outside the request dependency lifecycle.
    """
    _get_engine()
    assert _SessionLocal is not None
    session: Session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


async def ping_database(timeout: float = 2.0) -> str:
    """Return 'connected' or 'disconnected'. Used by /health."""
    import asyncio

    def _check() -> str:
        try:
            engine = _get_engine()
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return "connected"
        except Exception:
            return "disconnected"

    loop = asyncio.get_event_loop()
    try:
        return await asyncio.wait_for(loop.run_in_executor(None, _check), timeout=timeout)
    except (TimeoutError, Exception):
        return "disconnected"


ping_postgres = ping_database


def _execute_script(engine: Engine, sql: str) -> None:
    """Execute a multi-statement migration script for the active DBAPI."""
    raw: Any = engine.raw_connection()
    try:
        if engine.dialect.name == "sqlite":
            raw.executescript(sql)
        else:
            cursor = raw.cursor()
            try:
                cursor.execute(sql)
            finally:
                cursor.close()
        raw.commit()
    except Exception:
        raw.rollback()
        raise
    finally:
        raw.close()


_SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL CHECK (length(password_hash) > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workbenches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    config_path TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS workbenches_owner_user_id_idx ON workbenches(owner_user_id);

CREATE TABLE IF NOT EXISTS product_catalogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workbench_id INTEGER NOT NULL REFERENCES workbenches(id) ON DELETE CASCADE,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT,
    price NUMERIC,
    brand TEXT,
    locale TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS product_catalogs_workbench_id_idx ON product_catalogs(workbench_id);

CREATE TABLE IF NOT EXISTS marketing_kits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_catalog_id INTEGER NOT NULL REFERENCES product_catalogs(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'draft',
    score INTEGER,
    locale TEXT,
    brand_color_hex TEXT,
    style_prompt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS marketing_kits_product_catalog_id_idx
    ON marketing_kits(product_catalog_id);

CREATE TABLE IF NOT EXISTS copywriting_specs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    marketing_kit_id INTEGER NOT NULL UNIQUE REFERENCES marketing_kits(id) ON DELETE CASCADE,
    markdown TEXT,
    compliance_passed BOOLEAN,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS copywriting_specs_marketing_kit_id_idx
    ON copywriting_specs(marketing_kit_id);

CREATE TABLE IF NOT EXISTS hero_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    marketing_kit_id INTEGER NOT NULL REFERENCES marketing_kits(id) ON DELETE CASCADE,
    slot_index INTEGER NOT NULL CHECK (slot_index BETWEEN 1 AND 5),
    png_path TEXT,
    template_id TEXT,
    prompt TEXT,
    brand_color_hex TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (marketing_kit_id, slot_index)
);
CREATE INDEX IF NOT EXISTS hero_images_marketing_kit_id_idx ON hero_images(marketing_kit_id);
CREATE INDEX IF NOT EXISTS hero_images_kit_slot_idx ON hero_images(marketing_kit_id, slot_index);

CREATE TABLE IF NOT EXISTS detail_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    marketing_kit_id INTEGER NOT NULL REFERENCES marketing_kits(id) ON DELETE CASCADE,
    module_id TEXT NOT NULL CHECK (module_id IN ('M1','M2','M3','M4','M5','M6','M7','M8','M9')),
    png_path TEXT,
    prompt TEXT,
    brand_color_hex TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (marketing_kit_id, module_id)
);
CREATE INDEX IF NOT EXISTS detail_images_marketing_kit_id_idx ON detail_images(marketing_kit_id);
CREATE INDEX IF NOT EXISTS detail_images_kit_module_idx
    ON detail_images(marketing_kit_id, module_id);

CREATE TABLE IF NOT EXISTS bestseller_corpus_stubs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_path TEXT NOT NULL,
    locale TEXT,
    ingested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    embedding_provider TEXT,
    embedding_dim INTEGER
);

CREATE TABLE IF NOT EXISTS compliance_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    copywriting_spec_id INTEGER NOT NULL REFERENCES copywriting_specs(id) ON DELETE CASCADE,
    ruleset_id TEXT,
    score INTEGER,
    violations TEXT,
    advisory BOOLEAN NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS compliance_checks_copywriting_spec_id_idx
    ON compliance_checks(copywriting_spec_id);

CREATE TABLE IF NOT EXISTS quality_gates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    marketing_kit_id INTEGER NOT NULL REFERENCES marketing_kits(id) ON DELETE CASCADE,
    threshold INTEGER NOT NULL DEFAULT 95,
    human_edit_seconds INTEGER,
    passed_at TEXT
);
CREATE INDEX IF NOT EXISTS quality_gates_marketing_kit_id_idx
    ON quality_gates(marketing_kit_id);

CREATE TABLE IF NOT EXISTS text_editor_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hero_or_detail_image_id INTEGER NOT NULL,
    edits TEXT,
    inpaint_model TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TEXT
);
CREATE INDEX IF NOT EXISTS text_editor_sessions_image_id_idx
    ON text_editor_sessions(hero_or_detail_image_id);

CREATE TABLE IF NOT EXISTS model_provider_adapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    protocol TEXT NOT NULL CHECK (
        protocol IN ('openai_compatible','anthropic_compatible','image_generation')
    ),
    base_url TEXT NOT NULL,
    model_id TEXT NOT NULL,
    role TEXT,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS image_edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hero_or_detail_image_id INTEGER NOT NULL,
    text_layer_index INTEGER,
    original_text TEXT,
    new_text TEXT,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    op_type TEXT NOT NULL DEFAULT 'inpaint' CHECK (op_type IN ('inpaint','revert')),
    payload_json TEXT
);
CREATE INDEX IF NOT EXISTS image_edits_image_id_idx ON image_edits(hero_or_detail_image_id);
CREATE INDEX IF NOT EXISTS image_edits_op_type_idx ON image_edits(op_type);

CREATE TABLE IF NOT EXISTS generated_assets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    template_ref TEXT,
    output_kind TEXT,
    png_path TEXT NOT NULL,
    source_kit_id INTEGER REFERENCES marketing_kits(id) ON DELETE SET NULL,
    source_slot_id TEXT,
    source_job_id TEXT REFERENCES generation_jobs(id) ON DELETE SET NULL,
    source_output_id TEXT REFERENCES generation_outputs(id) ON DELETE SET NULL,
    source_image_ref TEXT REFERENCES source_images(id) ON DELETE SET NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS image_edit_results (
    id TEXT PRIMARY KEY,
    source_image_ref TEXT,
    target_image_id TEXT NOT NULL,
    result_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ready' CHECK (
        status IN ('pending','running','ready','succeeded','failed')
    ),
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT
);
CREATE INDEX IF NOT EXISTS image_edit_results_target_idx
    ON image_edit_results(target_image_id);

CREATE TABLE IF NOT EXISTS cost_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kit_id INTEGER,
    role TEXT,
    provider_name TEXT,
    tokens_in INTEGER,
    tokens_out INTEGER,
    image_count INTEGER,
    resolution TEXT,
    cost_usd NUMERIC,
    ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS cost_events_kit_id_idx ON cost_events(kit_id);
CREATE INDEX IF NOT EXISTS cost_events_kit_role_idx ON cost_events(kit_id, role);

CREATE TABLE IF NOT EXISTS custom_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    locale TEXT NOT NULL CHECK (locale IN ('zh','en')),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description TEXT,
    category TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    prompt_template TEXT NOT NULL,
    defaults TEXT NOT NULL DEFAULT '{}',
    variants TEXT NOT NULL DEFAULT '{}',
    category_tips TEXT NOT NULL DEFAULT '{}',
    examples TEXT NOT NULL DEFAULT '[]',
    supports_image_reference BOOLEAN NOT NULL DEFAULT 0,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    source_template_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS custom_templates_locale_idx ON custom_templates(locale);
CREATE INDEX IF NOT EXISTS custom_templates_enabled_idx ON custom_templates(enabled);

CREATE TABLE IF NOT EXISTS template_schemes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description TEXT,
    locale TEXT NOT NULL CHECK (locale IN ('zh','en')),
    enabled BOOLEAN NOT NULL DEFAULT 1,
    is_builtin BOOLEAN NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS template_schemes_locale_idx ON template_schemes(locale);
CREATE INDEX IF NOT EXISTS template_schemes_enabled_idx ON template_schemes(enabled);

CREATE TABLE IF NOT EXISTS template_scheme_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scheme_id INTEGER NOT NULL REFERENCES template_schemes(id) ON DELETE CASCADE,
    slot_id TEXT NOT NULL CHECK (slot_id IN (
        'H1','H2','H3','H4','H5','M1','M2','M3','M4','M5','M6','M7','M8','M9'
    )),
    template_ref TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (scheme_id, slot_id)
);
CREATE INDEX IF NOT EXISTS template_scheme_slots_scheme_idx ON template_scheme_slots(scheme_id);

CREATE TABLE IF NOT EXISTS kit_template_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    marketing_kit_id INTEGER NOT NULL UNIQUE REFERENCES marketing_kits(id) ON DELETE CASCADE,
    scheme_ref TEXT NOT NULL,
    scheme_name TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS kit_template_snapshots_kit_idx
    ON kit_template_snapshots(marketing_kit_id);

CREATE TABLE IF NOT EXISTS template_preview_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_ref TEXT NOT NULL,
    locale TEXT NOT NULL CHECK (locale IN ('zh','en')),
    sample_payload TEXT NOT NULL,
    prompt TEXT NOT NULL,
    png_path TEXT,
    cost_usd NUMERIC,
    status TEXT NOT NULL DEFAULT 'ready',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS template_preview_runs_template_idx
    ON template_preview_runs(template_ref);

CREATE TABLE IF NOT EXISTS source_images (
    id TEXT PRIMARY KEY,
    storage_path TEXT NOT NULL,
    mime_type TEXT NOT NULL CHECK (mime_type LIKE 'image/%'),
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    sha256 TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS source_images_sha256_idx ON source_images(sha256);

CREATE TABLE IF NOT EXISTS generation_jobs (
    id TEXT PRIMARY KEY,
    client_job_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (
        status IN (
            'planned','queued','running','stopping','stopped',
            'succeeded','failed','partial','interrupted'
        )
    ),
    cancel_requested BOOLEAN NOT NULL DEFAULT 0,
    source_image_ref TEXT NOT NULL REFERENCES source_images(id),
    user_prompt TEXT NOT NULL DEFAULT '',
    locale TEXT NOT NULL CHECK (locale IN ('zh','en')),
    marketing_kit_id INTEGER REFERENCES marketing_kits(id) ON DELETE SET NULL,
    planner_payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    finished_at TEXT,
    error_message TEXT
);
CREATE INDEX IF NOT EXISTS generation_jobs_status_idx ON generation_jobs(status);
CREATE INDEX IF NOT EXISTS generation_jobs_source_image_ref_idx
    ON generation_jobs(source_image_ref);
CREATE INDEX IF NOT EXISTS generation_jobs_marketing_kit_id_idx
    ON generation_jobs(marketing_kit_id);

CREATE TABLE IF NOT EXISTS generation_outputs (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
    output_key TEXT NOT NULL,
    output_kind TEXT NOT NULL CHECK (
        output_kind IN (
            'product_main','white_bg','solid_bg','banner','poster',
            'hero','detail','custom'
        )
    ),
    template_ref TEXT NOT NULL,
    template_name TEXT,
    aspect_ratio TEXT,
    width INTEGER NOT NULL DEFAULT 1024 CHECK (width > 0),
    height INTEGER NOT NULL DEFAULT 1024 CHECK (height > 0),
    prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (
        status IN ('queued','running','succeeded','failed','cancelled')
    ),
    destination_type TEXT NOT NULL DEFAULT 'asset' CHECK (
        destination_type IN ('kit_slot','asset')
    ),
    marketing_kit_id INTEGER REFERENCES marketing_kits(id) ON DELETE SET NULL,
    slot_id TEXT,
    asset_id TEXT,
    png_path TEXT,
    error_message TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (job_id, output_key)
);
CREATE INDEX IF NOT EXISTS generation_outputs_job_id_idx ON generation_outputs(job_id);
CREATE INDEX IF NOT EXISTS generation_outputs_status_idx ON generation_outputs(status);
CREATE INDEX IF NOT EXISTS generation_outputs_asset_id_idx ON generation_outputs(asset_id);

CREATE INDEX IF NOT EXISTS image_edit_results_target_image_id_idx
    ON image_edit_results(target_image_id);
"""


def _mark_all_sqlite_migrations(engine: Engine) -> None:
    versions = [p.name for p in sorted(_MIGRATION_DIR.glob("*.sql"))]
    with engine.begin() as conn:
        for version in versions:
            conn.execute(
                text("INSERT OR IGNORE INTO schema_migrations (version) VALUES (:version)"),
                {"version": version},
            )


def _ensure_sqlite_compat_columns(engine: Engine) -> None:
    """Additive compatibility for local SQLite DBs created before table unification."""
    additions = {
        "generated_assets": {
            "template_ref": "TEXT",
            "output_kind": "TEXT",
            "source_kit_id": "INTEGER",
            "source_slot_id": "TEXT",
            "source_job_id": "TEXT",
            "source_output_id": "TEXT",
            "source_image_ref": "TEXT",
        },
        "image_edit_results": {
            "source_image_ref": "TEXT",
        },
    }
    indexes = [
        "CREATE INDEX IF NOT EXISTS generated_assets_source_kit_idx"
        " ON generated_assets(source_kit_id)",
        "CREATE INDEX IF NOT EXISTS generated_assets_source_job_id_idx"
        " ON generated_assets(source_job_id)",
        "CREATE INDEX IF NOT EXISTS generated_assets_source_output_id_idx"
        " ON generated_assets(source_output_id)",
        "CREATE INDEX IF NOT EXISTS generated_assets_source_image_ref_idx"
        " ON generated_assets(source_image_ref)",
        "CREATE INDEX IF NOT EXISTS image_edit_results_source_image_ref_idx"
        " ON image_edit_results(source_image_ref)",
    ]
    with engine.begin() as conn:
        for table, columns in additions.items():
            existing = {
                str(row[1])
                for row in conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()
            }
            for column, ddl in columns.items():
                if column not in existing:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
        for sql in indexes:
            conn.exec_driver_sql(sql)
        generated_asset_columns = conn.exec_driver_sql(
            "PRAGMA table_info(generated_assets)"
        ).fetchall()
        id_column = next((row for row in generated_asset_columns if str(row[1]) == "id"), None)
        id_type = str(id_column[2]).upper() if id_column is not None else ""
        if "INT" not in id_type:
            conn.exec_driver_sql(
                "UPDATE generated_assets"
                " SET id = 'asset_' || lower(hex(randomblob(16)))"
                " WHERE id IS NULL OR trim(id) = '' OR id = 'None'"
            )
            conn.exec_driver_sql(
                "UPDATE generation_outputs"
                " SET asset_id = ("
                "   SELECT ga.id FROM generated_assets ga"
                "   WHERE ga.source_output_id = generation_outputs.id"
                "   ORDER BY ga.created_at DESC LIMIT 1"
                " )"
                " WHERE (asset_id IS NULL OR trim(asset_id) = '' OR asset_id = 'None')"
                " AND EXISTS ("
                "   SELECT 1 FROM generated_assets ga"
                "   WHERE ga.source_output_id = generation_outputs.id"
                " )"
            )


def generated_assets_use_text_ids(session: Session) -> bool:
    """Return true when SQLite stores generated asset ids as caller-provided text."""
    bind = session.get_bind()
    if bind.dialect.name != "sqlite":
        return False
    rows = session.connection().exec_driver_sql("PRAGMA table_info(generated_assets)").fetchall()
    id_column = next((row for row in rows if str(row[1]) == "id"), None)
    id_type = str(id_column[2]).upper() if id_column is not None else ""
    return "INT" not in id_type


def _ensure_sqlite_schema(engine: Engine) -> None:
    parsed = make_url(str(engine.url))
    if parsed.database not in {None, "", ":memory:"}:
        Path(str(parsed.database)).parent.mkdir(parents=True, exist_ok=True)
    _execute_script(engine, _SQLITE_SCHEMA)
    _ensure_sqlite_compat_columns(engine)
    _mark_all_sqlite_migrations(engine)


def _ensure_postgres_schema(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                "version TEXT PRIMARY KEY,"
                "applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)"
            )
        )
        applied = {
            str(row.version)
            for row in conn.execute(text("SELECT version FROM schema_migrations")).all()
        }
    for migration in sorted(_MIGRATION_DIR.glob("*.sql")):
        if migration.name in applied:
            continue
        _execute_script(engine, migration.read_text(encoding="utf-8"))
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO schema_migrations (version) VALUES (:version)"),
                {"version": migration.name},
            )


def ensure_schema() -> None:
    """Create/apply the database schema for the configured backend."""
    engine = _get_engine()
    if engine.dialect.name == "sqlite":
        _ensure_sqlite_schema(engine)
    else:
        _ensure_postgres_schema(engine)
    if _truthy_env("VISKIT_BOOTSTRAP_WORKSPACE", default=True):
        ensure_default_workspace()


def ensure_default_workspace() -> None:
    """Provision the single-tenant default user/workbench when absent."""
    engine = _get_engine()
    with engine.begin() as conn:
        user_id = conn.execute(text("SELECT MIN(id) FROM users")).scalar()
        if user_id is None:
            if engine.dialect.name == "sqlite":
                row = conn.execute(
                    text(
                        "INSERT INTO users (username, password_hash) "
                        "VALUES (:username, :password_hash) RETURNING id"
                    ),
                    {
                        "username": "viskit_local",
                        "password_hash": "local-bootstrap-disabled-login",
                    },
                ).scalar()
            else:
                row = conn.execute(
                    text(
                        "INSERT INTO users (username, password_hash) "
                        "VALUES (:username, :password_hash) "
                        "ON CONFLICT (username) DO UPDATE SET username=EXCLUDED.username "
                        "RETURNING id"
                    ),
                    {
                        "username": "viskit_local",
                        "password_hash": "local-bootstrap-disabled-login",
                    },
                ).scalar()
            if row is None:
                raise RuntimeError("default user bootstrap did not return an id")
            user_id = int(row)
        workbench_id = conn.execute(text("SELECT MIN(id) FROM workbenches")).scalar()
        if workbench_id is None:
            conn.execute(
                text(
                    "INSERT INTO workbenches (name, owner_user_id, config_path) "
                    "VALUES (:name, :owner_user_id, :config_path)"
                ),
                {
                    "name": "Viskit Local Workspace",
                    "owner_user_id": int(user_id),
                    "config_path": os.environ.get("CONFIG_PATH", "data/config.yaml"),
                },
            )


def migrate_from_env() -> None:
    if _truthy_env("VISKIT_AUTO_MIGRATE", default=True):
        ensure_schema()


def main() -> None:
    migrate_from_env()
    print(f"database migrated ({database_backend()})")


if __name__ == "__main__":
    main()

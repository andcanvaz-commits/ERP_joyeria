from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from backend.modules.config.settings import settings
from backend.modules.database.base import Base

# Importar los modulos de modelos puebla Base.metadata con todas las tablas.
from backend.modules.auth import models as auth_models  # noqa: F401
from backend.modules.catalog import models as catalog_models  # noqa: F401
from backend.modules.inventory import models as inventory_models  # noqa: F401
from backend.modules.production import models as production_models  # noqa: F401

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# URL desde settings (no desde alembic.ini) para no exponer credenciales.
config.set_main_option("sqlalchemy.url", settings.database_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.modules.config.settings import settings


@pytest.fixture()
def db_session():
    """Sesion sobre una conexion con una transaccion que siempre se revierte:
    los tests nunca dejan datos en la base real."""
    engine = create_engine(settings.database_url)
    connection = engine.connect()
    transaction = connection.begin()
    session_factory = sessionmaker(bind=connection, autoflush=False, autocommit=False)
    session = session_factory()
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
        engine.dispose()

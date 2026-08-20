import uuid

import pytest

from backend.modules.auth.dependencies import CurrentUser
from backend.modules.messages.service import MessagesService


@pytest.fixture()
def admin_user(db_session) -> CurrentUser:
    from backend.modules.auth.models import AuthUser

    user_id = uuid.uuid4()
    db_session.add(AuthUser(
        id=user_id, username=f"admin_{user_id.hex[:8]}", email=f"admin_{user_id.hex[:8]}@test.local",
        password_hash="mock_hashed", role="Admin",
    ))
    db_session.flush()
    return CurrentUser(id=user_id, username="admin_test", role="Admin", permissions=frozenset())


@pytest.fixture()
def operaciones_user(db_session) -> CurrentUser:
    from backend.modules.auth.models import AuthUser

    user_id = uuid.uuid4()
    db_session.add(AuthUser(
        id=user_id, username=f"jefe_{user_id.hex[:8]}", email=f"jefe_{user_id.hex[:8]}@test.local",
        password_hash="mock_hashed", role="Producción/Inventario",
    ))
    db_session.flush()
    return CurrentUser(id=user_id, username="jefe_test", role="Producción/Inventario", permissions=frozenset())


@pytest.fixture()
def messages_service(db_session) -> MessagesService:
    return MessagesService(db_session)

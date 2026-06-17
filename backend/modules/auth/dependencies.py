from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class CurrentUser:
    id: UUID
    username: str
    permissions: frozenset[str]


def get_current_user() -> CurrentUser:
    raise NotImplementedError("JWT validation will be implemented in auth module.")

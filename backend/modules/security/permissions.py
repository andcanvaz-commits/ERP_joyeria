from backend.modules.auth.dependencies import CurrentUser


def require_permission(user: CurrentUser, permission: str) -> None:
    if permission not in user.permissions:
        raise PermissionError(f"Missing permission: {permission}")

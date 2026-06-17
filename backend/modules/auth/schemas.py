from pydantic import BaseModel, ConfigDict


class TokenPair(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str
    password: str


class AuthUserRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    username: str
    role: str
    permissions: list[str]

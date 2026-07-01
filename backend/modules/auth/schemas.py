from pydantic import BaseModel, ConfigDict, Field


class TokenPair(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class AuthUserRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    username: str
    first_name: str
    last_name: str
    email: str
    role: str
    employee_code: str | None = None
    permissions: list[str]
    is_active: bool = True


class AuthUserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)
    role: str = Field(default="Admin", min_length=3, max_length=40)


class AuthUserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)
    role: str = Field(default="Admin", min_length=3, max_length=40)


class AuthUserCredentialRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user: AuthUserRead
    temporary_password: str

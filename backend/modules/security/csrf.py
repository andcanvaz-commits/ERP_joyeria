"""Proteccion CSRF por patron double-submit cookie.

El servidor entrega una cookie `csrf_token` legible por JS (no HttpOnly). El
frontend la lee y la reenvia en el header `X-CSRF-Token` en cada peticion que
modifica datos (POST/PUT/PATCH/DELETE). El backend exige que el header coincida
con la cookie. Un atacante cross-site no puede leer la cookie (same-origin
policy) ni fijar el header (CORS), por lo que no puede falsificar la peticion,
aunque la cookie de sesion viaje automaticamente.
"""
import secrets

CSRF_COOKIE_NAME = "csrf_token"
CSRF_HEADER_NAME = "X-CSRF-Token"

# Metodos que no modifican estado: no requieren token CSRF.
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})


def generate_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def tokens_match(cookie_token: str | None, header_token: str | None) -> bool:
    if not cookie_token or not header_token:
        return False
    return secrets.compare_digest(cookie_token, header_token)

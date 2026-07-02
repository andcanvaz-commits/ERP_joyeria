"use client";

import { FormEvent, useEffect, useState } from "react";
import { KeyRound, LockKeyhole, LogIn } from "lucide-react";
import { ApiError, isAuthenticated } from "@/lib/api";
import { getCurrentUser, login, setInitialPassword } from "@/lib/auth-api";
import { homeRoute, normalizeRole } from "@/lib/roles";

function validateNewPassword(next: string, confirm: string): string | null {
  if (next.length < 8) return "La contrasena debe tener al menos 8 caracteres.";
  if (!/[a-zA-Z]/.test(next)) return "La contrasena debe incluir al menos una letra.";
  if (!/[0-9]/.test(next)) return "La contrasena debe incluir al menos un numero.";
  if (next !== confirm) return "La confirmacion no coincide.";
  return null;
}

async function goToHome() {
  try {
    const current = await getCurrentUser();
    window.location.href = homeRoute(normalizeRole(current.role));
  } catch {
    window.location.href = "/dashboard";
  }
}

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "change">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Si ya hay sesion con cambio pendiente (p.ej. llego redirigido), pide el cambio aqui.
  useEffect(() => {
    if (!isAuthenticated()) return;
    getCurrentUser()
      .then((user) => {
        if (user.must_change_password) setMode("change");
      })
      .catch(() => undefined);
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      const current = await getCurrentUser();
      if (current.must_change_password) {
        setMode("change");
        setPassword("");
      } else {
        window.location.href = homeRoute(normalizeRole(current.role));
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo iniciar sesion.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const validationError = validateNewPassword(newPassword, confirmPassword);
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsSubmitting(true);
    try {
      await setInitialPassword(newPassword);
      await goToHome();
    } catch (nextError) {
      const message = nextError instanceof ApiError ? nextError.message : "No se pudo cambiar la contrasena.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="loginPage">
      <section className="loginPanel card">
        <div className="loginBrand">
          <div className="brandMark">
            {mode === "change" ? <KeyRound aria-hidden="true" size={18} /> : <LockKeyhole aria-hidden="true" size={18} />}
          </div>
          <div>
            <h1>Fenix Global</h1>
            <p>{mode === "change" ? "Crea tu nueva contraseña" : "Joyeria · Ingreso operativo"}</p>
          </div>
        </div>

        {error ? <div className="notice noticeError">{error}</div> : null}

        {mode === "login" ? (
          <form className="loginForm" onSubmit={handleLogin}>
            <label>
              <span>Usuario o correo</span>
              <input
                autoComplete="username"
                className="field"
                onChange={(event) => setUsername(event.target.value)}
                required
                value={username}
              />
            </label>
            <label>
              <span>Contraseña</span>
              <input
                autoComplete="current-password"
                className="field"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
            <button className="button buttonPrimary" disabled={isSubmitting} type="submit">
              <LogIn aria-hidden="true" size={17} />
              {isSubmitting ? "Ingresando" : "Entrar"}
            </button>
          </form>
        ) : (
          <form className="loginForm" onSubmit={handleChange}>
            <p className="panelText">Tu contraseña es temporal. Define una nueva para continuar.</p>
            <label>
              <span>Nueva contraseña</span>
              <input
                autoComplete="new-password"
                className="field"
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type="password"
                value={newPassword}
              />
            </label>
            <label>
              <span>Confirmar contraseña</span>
              <input
                autoComplete="new-password"
                className="field"
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type="password"
                value={confirmPassword}
              />
            </label>
            <p className="panelText">Minimo 8 caracteres, con al menos una letra y un numero.</p>
            <button className="button buttonPrimary" disabled={isSubmitting} type="submit">
              <KeyRound aria-hidden="true" size={17} />
              {isSubmitting ? "Guardando" : "Guardar y entrar"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

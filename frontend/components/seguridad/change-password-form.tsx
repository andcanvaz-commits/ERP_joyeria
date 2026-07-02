"use client";

import { FormEvent, useState } from "react";
import { KeyRound } from "lucide-react";
import { ApiError } from "@/lib/api";
import { changePassword } from "@/lib/auth-api";

function validate(current: string, next: string, confirm: string): string | null {
  if (!current) return "Ingresa tu contrasena actual.";
  if (next.length < 8) return "La nueva contrasena debe tener al menos 8 caracteres.";
  if (!/[a-zA-Z]/.test(next)) return "La nueva contrasena debe incluir al menos una letra.";
  if (!/[0-9]/.test(next)) return "La nueva contrasena debe incluir al menos un numero.";
  if (next === current) return "La nueva contrasena debe ser distinta de la actual.";
  if (next !== confirm) return "La confirmacion no coincide con la nueva contrasena.";
  return null;
}

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const validationError = validate(current, next, confirm);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setSuccess("Contrasena actualizada correctamente.");
    } catch (nextError) {
      const message =
        nextError instanceof ApiError ? nextError.message : "No se pudo actualizar la contrasena.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="card panelBody">
      <div className="panelHeader">
        <div>
          <h2 className="panelTitle">Cambiar contrasena</h2>
          <p className="panelText">Actualiza la contrasena de tu cuenta.</p>
        </div>
      </div>

      {error ? <div className="notice noticeError">{error}</div> : null}
      {success ? <div className="notice noticeSuccess">{success}</div> : null}

      <form className="loginForm" onSubmit={handleSubmit}>
        <label>
          <span>Contrasena actual</span>
          <input
            autoComplete="current-password"
            className="field"
            onChange={(event) => setCurrent(event.target.value)}
            required
            type="password"
            value={current}
          />
        </label>
        <label>
          <span>Nueva contrasena</span>
          <input
            autoComplete="new-password"
            className="field"
            onChange={(event) => setNext(event.target.value)}
            required
            type="password"
            value={next}
          />
        </label>
        <label>
          <span>Confirmar nueva contrasena</span>
          <input
            autoComplete="new-password"
            className="field"
            onChange={(event) => setConfirm(event.target.value)}
            required
            type="password"
            value={confirm}
          />
        </label>
        <p className="panelText">Minimo 8 caracteres, con al menos una letra y un numero.</p>
        <button className="button buttonPrimary" disabled={isSubmitting} type="submit">
          <KeyRound aria-hidden="true" size={17} />
          {isSubmitting ? "Guardando" : "Actualizar contrasena"}
        </button>
      </form>
    </section>
  );
}

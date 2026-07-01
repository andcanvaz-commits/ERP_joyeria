"use client";

import { FormEvent, useState } from "react";
import { LockKeyhole, LogIn } from "lucide-react";
import { login } from "@/lib/auth-api";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      window.location.href = "/produccion";
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo iniciar sesion.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="loginPage">
      <section className="loginPanel card">
        <div className="loginBrand">
          <div className="brandMark">
            <LockKeyhole aria-hidden="true" size={18} />
          </div>
          <div>
            <h1>Fenix Global</h1>
            <p>Joyeria · Ingreso operativo</p>
          </div>
        </div>

        {error ? <div className="notice noticeError">{error}</div> : null}

        <form className="loginForm" onSubmit={handleSubmit}>
          <label>
            <span>Usuario</span>
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
      </section>
    </main>
  );
}

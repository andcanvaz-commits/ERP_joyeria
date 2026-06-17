"use client";

import { FormEvent, useState } from "react";
import { LockKeyhole, LogIn } from "lucide-react";
import { login } from "@/lib/auth-api";

export default function LoginPage() {
  const [username, setUsername] = useState("owner");
  const [password, setPassword] = useState("Owner123!");
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
            <h1>ERP Joyeria</h1>
            <p>Ingreso operativo</p>
          </div>
        </div>

        {error ? <div className="notice noticeError">{error}</div> : null}

        <form className="loginForm" onSubmit={handleSubmit}>
          <label>
            <span>Usuario</span>
            <input className="field" onChange={(event) => setUsername(event.target.value)} value={username} />
          </label>
          <label>
            <span>Contraseña</span>
            <input
              className="field"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          <button className="button buttonPrimary" disabled={isSubmitting} type="submit">
            <LogIn aria-hidden="true" size={17} />
            {isSubmitting ? "Ingresando" : "Entrar"}
          </button>
        </form>

        <div className="loginAccounts">
          <button
            className="processPicker"
            onClick={() => {
              setUsername("owner");
              setPassword("Owner123!");
            }}
            type="button"
          >
            <strong>Owner</strong>
            <span>crear procesos y ejecutar</span>
          </button>
          <button
            className="processPicker"
            onClick={() => {
              setUsername("admin");
              setPassword("Admin123!");
            }}
            type="button"
          >
            <strong>Admin</strong>
            <span>solo revision</span>
          </button>
        </div>
      </section>
    </main>
  );
}

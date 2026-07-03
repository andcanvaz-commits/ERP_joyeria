# Rediseño "Instrumento de precisión" — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la identidad visual "joyería oro/crema" por defecto con un lenguaje "instrumento de precisión" (papel técnico, tinta ónix, oro solo como hilo, tipografía punzón+grotesca+mono, signature de escala de calibre), aplicado a todo el sistema.

**Architecture:** Un único sistema de tokens en `globals.css` alimenta todas las superficies. Dos componentes React compartidos encapsulan la signature (`CaliperScale`) y el estado (`StatusPunch`), reusados en dashboards, inventario y reportes. Los cambios van superficie por superficie, cada uno verificable en el navegador.

**Tech Stack:** Next.js (App Router), React, TypeScript, CSS plano (`globals.css`), `next/font/google`. Docker dev en `http://localhost:3001`; typecheck con `docker compose exec -T web npx tsc --noEmit`.

## Global Constraints

- Oro (`--gold` `#A67C34`) SOLO como línea 1px, glifo de punzón o subrayado. Nunca relleno ni gradiente. Oro como texto usa `--gold-deep` `#7A5A22`.
- Todo número operativo (stock, pesos, %, códigos, cantidades) se renderiza en `--font-mono` (IBM Plex Mono) con figuras tabulares.
- Sin CDN externas: fuentes self-host vía `next/font/google` (self-hosted por Next).
- Contraste WCAG AA en texto y estados. Foco de teclado visible. `prefers-reduced-motion` respetado.
- Responsive hasta móvil; tablas densas con scroll horizontal contenido (`overflow-x:auto`).
- No cambia lógica de negocio, endpoints ni modelos.
- Paleta de tokens (fuente de verdad):
  ```
  --paper #FBFAF7  --surface #FFFFFF  --surface-2 #F4F1EA
  --ink #17150F  --muted #6E675B  --line #E4DFD3
  --gold #A67C34  --gold-deep #7A5A22
  --danger #B23B3B  --success #2F7D5B  --warning #9A6B1E
  ```
- Verificación de cada tarea: `docker compose exec -T web npx tsc --noEmit` → exit 0, y revisión visual en `http://localhost:3001`.

---

## File Structure

- `app/layout.tsx` — carga de las 3 fuentes, expone `--font-display`, `--font-body`, `--font-mono`.
- `app/globals.css` — tokens en `:root`, remap de `font-family`, primitivas de chrome/tarjeta, clases de `CaliperScale`, `StatusPunch`, tabla de ensayo.
- `components/ui/caliper-scale.tsx` — NUEVO. Signature reusable.
- `components/ui/status-punch.tsx` — NUEVO. Punzón de estado.
- `components/ui/status-badge.tsx` — reusa `StatusPunch`.
- `components/layout/app-shell.tsx` — chrome/sidebar papel + hilo de oro activo.
- `app/login/page.tsx` — login.
- `components/dashboard/system-dashboard.tsx`, `components/production/production-dashboard.tsx` — dashboards.
- `components/inventory/inventory-dashboard.tsx` — inventario.
- `components/reportes/reportes-view.tsx`, `components/reportes/inventory-reports.tsx` — reportes.

---

## Task 1: Fuentes y tokens base

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css:1-110` (bloque `:root` y `body`/headings base)

**Interfaces:**
- Produces: variables CSS `--font-display`, `--font-body`, `--font-mono` y todos los tokens de color de Global Constraints, disponibles para el resto de tareas.

- [ ] **Step 1: Cambiar las fuentes en `app/layout.tsx`**

Reemplaza los imports y la config de `next/font/google`:

```tsx
import { Saira_Condensed, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";

const display = Saira_Condensed({
  subsets: ["latin"],
  display: "swap",
  weight: ["600", "700"],
  variable: "--font-display",
});

const body = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
  variable: "--font-body",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
  variable: "--font-mono",
});
```

Y en `<html>`:

```tsx
<html lang="es" className={`${display.variable} ${body.variable} ${mono.variable}`}>
```

- [ ] **Step 2: Reemplazar el bloque `:root` de `app/globals.css`**

Sustituye el primer bloque `:root` (líneas ~1-27, tokens `--background`..`--sidebar-border`) por:

```css
:root {
  --paper: #FBFAF7;
  --surface: #FFFFFF;
  --surface-2: #F4F1EA;
  --border: #E4DFD3;
  --line: #E4DFD3;
  --text: #17150F;
  --ink: #17150F;
  --muted: #6E675B;
  --gold: #A67C34;
  --gold-deep: #7A5A22;
  /* Compat: nombres viejos remapeados al nuevo sistema */
  --background: var(--paper);
  --surface-muted: var(--surface-2);
  --primary: var(--gold-deep);
  --primary-strong: var(--gold-deep);
  --primary-light: var(--line);
  --primary-soft: var(--surface-2);
  --success: #2F7D5B;
  --warning: #9A6B1E;
  --danger: #B23B3B;
  --pending: #6E675B;
  --shadow: 0 1px 2px rgba(23, 21, 15, 0.05);
  /* Sidebar papel */
  --sidebar-bg: var(--paper);
  --sidebar-surface: var(--surface);
  --sidebar-text: #2A2620;
  --sidebar-muted: #8F867A;
  --sidebar-active-bg: var(--surface-2);
  --sidebar-border: var(--line);
}
```

Mantener los bloques `:root` siguientes (`--accent-deep`, `--doc-*`) tal cual.

- [ ] **Step 3: Remapear `font-family` en `app/globals.css`**

Reemplaza TODAS las apariciones de `var(--font-serif, Georgia), Georgia, serif;` por `var(--font-display, "Arial Narrow"), sans-serif;` (usar Grep/replace_all). Reemplaza `var(--font-sans, "Segoe UI"), "Segoe UI", Arial, sans-serif;` por `var(--font-body, "Segoe UI"), "Segoe UI", Arial, sans-serif;`. Reemplaza las 2 reglas `font-family: monospace;` por `font-family: var(--font-mono, ui-monospace), monospace; font-variant-numeric: tabular-nums;`. Reemplaza `var(--font-sans, Arial), Arial, sans-serif;` (línea ~3489) por `var(--font-body, Arial), Arial, sans-serif;`.

- [ ] **Step 4: Añadir regla global de números tabulares**

Tras el bloque `body {`, añade:

```css
.mono, .num {
  font-family: var(--font-mono, ui-monospace), monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
```

- [ ] **Step 5: Typecheck y revisión visual**

Run: `docker compose exec -T web npx tsc --noEmit`
Expected: exit 0.
Abrir `http://localhost:3001` (login) y una vista interna: el fondo es papel, los títulos usan condensada, los números legibles. No hay oro de relleno.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/layout.tsx frontend/app/globals.css
git commit -m "feat(ui): tokens papel/onix/oro y fuentes punzon+grotesca+mono"
```

---

## Task 2: Componente CaliperScale (signature)

**Files:**
- Create: `components/ui/caliper-scale.tsx`
- Modify: `app/globals.css` (añadir al final las clases `.caliper*`)

**Interfaces:**
- Produces:
  ```ts
  type CaliperScaleProps = {
    value: number;        // valor actual
    max: number;          // fin de la escala
    ticks?: number;       // nº de marcas mayores (default 10)
    limit?: number | null;   // marca fija de límite/mínimo (△), opcional
    limitMode?: "ceiling" | "floor"; // ceiling: rojo si value>limit; floor: rojo si value<limit
    label?: string;       // texto a la derecha (ej "6/9" o "0.7%")
    ariaLabel?: string;
  };
  export function CaliperScale(props: CaliperScaleProps): JSX.Element
  ```

- [ ] **Step 1: Crear `components/ui/caliper-scale.tsx`**

```tsx
type CaliperScaleProps = {
  value: number;
  max: number;
  ticks?: number;
  limit?: number | null;
  limitMode?: "ceiling" | "floor";
  label?: string;
  ariaLabel?: string;
};

export function CaliperScale({
  value,
  max,
  ticks = 10,
  limit = null,
  limitMode = "ceiling",
  label,
  ariaLabel,
}: CaliperScaleProps) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  const limitPct =
    limit != null ? Math.max(0, Math.min(100, (limit / safeMax) * 100)) : null;
  const over =
    limit != null &&
    (limitMode === "ceiling" ? value > limit : value < limit);

  return (
    <div
      className={`caliper ${over ? "caliperOver" : ""}`}
      role="img"
      aria-label={ariaLabel ?? `${value} de ${max}`}
    >
      <div className="caliperTrack">
        {Array.from({ length: ticks + 1 }).map((_, i) => (
          <span key={i} className="caliperTick" style={{ left: `${(i / ticks) * 100}%` }} />
        ))}
        <span className="caliperFill" style={{ width: `${pct}%` }} />
        {limitPct != null ? (
          <span className="caliperLimit" style={{ left: `${limitPct}%` }} aria-hidden="true" />
        ) : null}
        <span className="caliperMarker" style={{ left: `${pct}%` }} aria-hidden="true" />
      </div>
      {label ? <span className="caliperLabel num">{label}</span> : null}
    </div>
  );
}
```

- [ ] **Step 2: Añadir CSS de la escala al final de `app/globals.css`**

```css
.caliper { display: flex; align-items: center; gap: 10px; }
.caliperTrack {
  position: relative; flex: 1; height: 14px;
  border-bottom: 1px solid var(--line);
}
.caliperTick {
  position: absolute; bottom: 0; width: 1px; height: 5px;
  background: var(--line);
}
.caliperFill {
  position: absolute; bottom: 0; left: 0; height: 2px;
  background: var(--ink);
}
.caliperMarker {
  position: absolute; bottom: -2px; width: 2px; height: 12px;
  background: var(--gold); transform: translateX(-1px);
}
.caliperLimit {
  position: absolute; bottom: 2px; width: 0; height: 0;
  border-left: 4px solid transparent; border-right: 4px solid transparent;
  border-bottom: 6px solid var(--muted); transform: translateX(-4px);
}
.caliperOver .caliperFill { background: var(--danger); }
.caliperOver .caliperMarker { background: var(--danger); }
.caliperLabel { font-size: 12px; color: var(--muted); flex-shrink: 0; min-width: 42px; text-align: right; }
@media (prefers-reduced-motion: no-preference) {
  .caliperFill, .caliperMarker { transition: left .25s ease, width .25s ease; }
}
```

- [ ] **Step 3: Typecheck**

Run: `docker compose exec -T web npx tsc --noEmit`
Expected: exit 0 (componente sin usar aún, pero compila).

- [ ] **Step 4: Commit**

```bash
git add frontend/components/ui/caliper-scale.tsx frontend/app/globals.css
git commit -m "feat(ui): componente CaliperScale (signature de escala de calibre)"
```

---

## Task 3: Componente StatusPunch

**Files:**
- Create: `components/ui/status-punch.tsx`
- Modify: `components/ui/status-badge.tsx`
- Modify: `app/globals.css` (clases `.punch*`)

**Interfaces:**
- Consumes: nada.
- Produces:
  ```ts
  type PunchTone = "neutral" | "active" | "done" | "danger" | "warning";
  export function StatusPunch(props: { label: string; tone?: PunchTone }): JSX.Element
  ```

- [ ] **Step 1: Crear `components/ui/status-punch.tsx`**

```tsx
type PunchTone = "neutral" | "active" | "done" | "danger" | "warning";

export function StatusPunch({ label, tone = "neutral" }: { label: string; tone?: PunchTone }) {
  return <span className={`punch punch-${tone}`}>{label}</span>;
}
```

- [ ] **Step 2: Añadir CSS del punzón al final de `app/globals.css`**

```css
.punch {
  display: inline-flex; align-items: center;
  font-family: var(--font-display, sans-serif);
  font-weight: 600; font-size: 11px; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--ink);
  padding: 2px 8px; border: 1px solid var(--line); border-radius: 3px;
  background: var(--surface);
}
.punch-active { border-color: var(--gold); color: var(--gold-deep); }
.punch-done { border-color: var(--success); color: var(--success); }
.punch-danger { border-color: var(--danger); color: var(--danger); }
.punch-warning { border-color: var(--warning); color: var(--warning); }
```

- [ ] **Step 3: Reescribir `components/ui/status-badge.tsx` para usar `StatusPunch`**

```tsx
import { StatusPunch } from "./status-punch";

const toneByValue: Record<string, "neutral" | "active" | "done" | "danger" | "warning"> = {
  BORRADOR: "neutral",
  PENDIENTE: "neutral",
  EN_PROCESO: "active",
  PAUSADA: "warning",
  FINALIZADA: "done",
  CANCELADA: "danger",
};

const statusLabelByValue: Record<string, string> = {
  BORRADOR: "Borrador",
  PENDIENTE: "Pendiente",
  EN_PROCESO: "En proceso",
  PAUSADA: "Pausada",
  FINALIZADA: "Finalizada",
  CANCELADA: "Cancelada",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = toneByValue[status] ?? "neutral";
  const label = statusLabelByValue[status] ?? status;
  return <StatusPunch label={label} tone={tone} />;
}
```

- [ ] **Step 4: Typecheck y revisión visual**

Run: `docker compose exec -T web npx tsc --noEmit`
Expected: exit 0. En cualquier vista con `StatusBadge`, el estado se ve como punzón en marco fino MAYÚSCULAS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ui/status-punch.tsx frontend/components/ui/status-badge.tsx frontend/app/globals.css
git commit -m "feat(ui): StatusPunch y StatusBadge como punzon grabado"
```

---

## Task 4: Chrome — sidebar papel + tarjeta de ensayo

**Files:**
- Modify: `app/globals.css` (reglas `.sidebar`, `.nav`, `.navItem`, `.navItemActive`, `.card`)
- Modify: `components/layout/app-shell.tsx` (solo si hay estilos inline de sidebar)

**Interfaces:**
- Consumes: tokens de Task 1.
- Produces: `.card` con estética de ticket de ensayo (hairline + marcas de registro); sidebar papel con hilo de oro activo.

- [ ] **Step 1: Localizar reglas actuales**

Run: `docker compose exec -T web sh -c "grep -n '\.sidebar\|\.navItemActive\|^\.card' app/globals.css | head"` (o usar Grep). Anota los rangos de línea de `.sidebar`, `.navItem`, `.navItemActive`, `.card`.

- [ ] **Step 2: Reescribir el bloque de sidebar/nav**

Reemplaza las reglas `.sidebar`, `.navItem`, `.navItemActive` por:

```css
.sidebar {
  background: var(--sidebar-bg);
  color: var(--sidebar-text);
  border-right: 1px solid var(--line);
}
.navItem {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 14px; color: var(--sidebar-text);
  border-left: 2px solid transparent;
  font-weight: 500;
}
.navItem:hover { background: var(--surface-2); }
.navItemActive {
  border-left: 2px solid var(--gold);
  background: var(--surface-2);
  color: var(--ink); font-weight: 600;
}
```

- [ ] **Step 3: Reescribir `.card` como ticket de ensayo**

Reemplaza la regla `.card` por:

```css
.card {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 4px;
  box-shadow: var(--shadow);
}
.card::before, .card::after {
  content: ""; position: absolute; width: 6px; height: 6px;
  border-color: var(--gold); border-style: solid; opacity: .5;
}
.card::before { top: 6px; left: 6px; border-width: 1px 0 0 1px; }
.card::after { bottom: 6px; right: 6px; border-width: 0 1px 1px 0; }
```

- [ ] **Step 4: Ajustar estilos inline del shell si aplica**

Abrir `components/layout/app-shell.tsx`. Si el sidebar o el marcador activo usan colores grafito en `style={{...}}`, quitarlos y dejar que las clases de globals manden. Si todo es por clase, no tocar.

- [ ] **Step 5: Typecheck y revisión visual**

Run: `docker compose exec -T web npx tsc --noEmit`
Expected: exit 0. Sidebar en papel; ítem activo con hilo de oro a la izquierda. Tarjetas con marcas de registro en esquinas.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/globals.css frontend/components/layout/app-shell.tsx
git commit -m "feat(ui): chrome papel, sidebar con hilo de oro y tarjeta de ensayo"
```

---

## Task 5: Login

**Files:**
- Modify: `app/login/page.tsx`
- Modify: `app/globals.css` (reglas `.loginPage`, `.loginPanel`, `.loginBrand`, `.brandMark`, `.notice*`)

**Interfaces:**
- Consumes: tokens y tipografía.

- [ ] **Step 1: Reescribir estilos de login en `app/globals.css`**

Reemplaza `.loginPage`, `.loginPanel`, `.loginBrand`, `.brandMark`:

```css
.loginPage {
  min-height: 100vh; display: grid; place-items: center;
  background: var(--paper); padding: 24px;
}
.loginPanel { width: 100%; max-width: 380px; padding: 32px; }
.loginBrand { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
.loginBrand h1 {
  font-family: var(--font-display, sans-serif);
  text-transform: uppercase; letter-spacing: 0.12em;
  font-size: 22px; font-weight: 700; color: var(--ink); margin: 0;
}
.loginBrand p { color: var(--muted); font-size: 12px; margin: 2px 0 0; }
.brandMark {
  width: 34px; height: 34px; display: grid; place-items: center;
  border: 1px solid var(--gold); border-radius: 4px; color: var(--gold-deep);
}
```

- [ ] **Step 2: Añadir hilo de oro bajo el título**

En `app/login/page.tsx`, tras el `<div className="loginBrand">…</div>`, añade un divisor:

```tsx
<div className="goldRule" aria-hidden="true" />
```

Y en `app/globals.css`:

```css
.goldRule { height: 1px; background: var(--gold); opacity: .6; margin-bottom: 20px; }
```

- [ ] **Step 3: Verificar copy de error**

Confirmar que el `<div className="notice noticeError">{error}</div>` existente sigue mostrando mensajes del sistema (sin apología). No requiere cambio de código; solo verificación.

- [ ] **Step 4: Typecheck y revisión visual**

Run: `docker compose exec -T web npx tsc --noEmit`
Expected: exit 0. Login: wordmark grabado, hilo de oro, un solo acento. Probar login `admin`/`DevAdmin2026` en `http://localhost:3001`.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/login/page.tsx frontend/app/globals.css
git commit -m "feat(ui): login instrumento de precision"
```

---

## Task 6: Dashboards (sistema + producción)

**Files:**
- Modify: `components/production/production-dashboard.tsx`
- Modify: `components/dashboard/system-dashboard.tsx`
- Modify: `app/globals.css` (KPI con subrayado de oro)

**Interfaces:**
- Consumes: `CaliperScale`, `StatusPunch`, `.card`.

- [ ] **Step 1: Sustituir la barra de avance por `CaliperScale` en producción**

En `components/production/production-dashboard.tsx`, importar:

```tsx
import { CaliperScale } from "@/components/ui/caliper-scale";
```

Localizar el render de orden en curso (busca `progressFill` / `getRunProgress`). Reemplazar el bloque de barra de progreso por:

```tsx
<CaliperScale
  value={run.stages.filter((s) => s.status === "FINALIZADA").length}
  max={run.stages.length}
  ticks={run.stages.length}
  label={`${run.stages.filter((s) => s.status === "FINALIZADA").length}/${run.stages.length}`}
  ariaLabel="Avance de la orden"
/>
```

- [ ] **Step 2: Añadir escala de merma vs límite**

Donde la orden muestra merma (`waste_percent` / `waste_limit_percent`), añadir:

```tsx
<CaliperScale
  value={Number(run.waste_percent ?? 0)}
  max={Math.max(Number(run.waste_limit_percent) * 2, 1)}
  limit={Number(run.waste_limit_percent)}
  limitMode="ceiling"
  label={`${Number(run.waste_percent ?? 0).toFixed(1)}%`}
  ariaLabel="Merma frente al limite"
/>
```

- [ ] **Step 3: KPIs con número mono y subrayado de oro en `system-dashboard.tsx`**

Localizar las tarjetas de indicadores. Envolver el número en `<span className="kpiNum num">` y añadir la clase `kpiCard` al contenedor. CSS en `app/globals.css`:

```css
.kpiNum { font-size: 30px; font-weight: 600; color: var(--ink); display: inline-block; }
.kpiNum::after { content: ""; display: block; height: 2px; width: 28px; background: var(--gold); margin-top: 4px; }
.kpiCard .kpiLabel { font-family: var(--font-display, sans-serif); text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; color: var(--muted); }
```

- [ ] **Step 4: Estados como punzón**

Verificar que los estados usan `StatusBadge`/`StatusPunch` (ya restilizado en Task 3). Si hay labels de estado inline sueltos, reemplazarlos por `<StatusPunch label=… tone=… />`.

- [ ] **Step 5: Typecheck y revisión visual**

Run: `docker compose exec -T web npx tsc --noEmit`
Expected: exit 0. Dashboard producción: avance y merma como escala de calibre (merma en rojo si pasa el `△`); KPIs con número mono subrayado en oro.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/production/production-dashboard.tsx frontend/components/dashboard/system-dashboard.tsx frontend/app/globals.css
git commit -m "feat(ui): dashboards con escala de calibre y KPIs mono"
```

---

## Task 7: Vista inventario

**Files:**
- Modify: `components/inventory/inventory-dashboard.tsx`
- Modify: `app/globals.css` (tabla de ensayo)

**Interfaces:**
- Consumes: `CaliperScale`, `.card`, `--font-mono`.

- [ ] **Step 1: Estilo de tabla de ensayo**

Añadir al final de `app/globals.css`:

```css
.assayTable { width: 100%; border-collapse: collapse; }
.assayTable th {
  font-family: var(--font-display, sans-serif); text-transform: uppercase;
  letter-spacing: 0.06em; font-size: 11px; color: var(--muted);
  text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line);
}
.assayTable td { padding: 9px 10px; border-bottom: 1px solid var(--line); font-size: 13px; }
.assayTable td.num { font-family: var(--font-mono, monospace); font-variant-numeric: tabular-nums; text-align: right; }
.assayTableWrap { overflow-x: auto; }
```

- [ ] **Step 2: Aplicar clases a la tabla de inventario**

En `components/inventory/inventory-dashboard.tsx`, envolver la tabla en `<div className="assayTableWrap">`, poner `className="assayTable"` en la `<table>`, y añadir `className="num"` a las celdas de stock, mínimo, costo y cantidades.

- [ ] **Step 3: Escala de stock vs mínimo por fila**

Importar `CaliperScale`. En la celda de stock (o una columna nueva "Nivel"), añadir:

```tsx
<CaliperScale
  value={Number(item.stock_actual)}
  max={Math.max(Number(item.stock_minimo) * 2, Number(item.stock_actual), 1)}
  limit={Number(item.stock_minimo)}
  limitMode="floor"
  ariaLabel="Stock frente al minimo"
/>
```

(Ajustar los nombres de campo a los reales del tipo de item; verificar en `lib/inventory-api.ts`.)

- [ ] **Step 4: Typecheck y revisión visual**

Run: `docker compose exec -T web npx tsc --noEmit`
Expected: exit 0. Inventario: tabla con cabeceras grabadas, números mono alineados a la derecha, escala de stock (rojo bajo el mínimo).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/inventory/inventory-dashboard.tsx frontend/app/globals.css
git commit -m "feat(ui): inventario como tabla de ensayo con escala de stock"
```

---

## Task 8: Reportes

**Files:**
- Modify: `components/reportes/reportes-view.tsx`
- Modify: `components/reportes/inventory-reports.tsx`
- Modify: `app/globals.css` (totales subrayados)

**Interfaces:**
- Consumes: `.assayTable`, `.card`, `--font-mono`.

- [ ] **Step 1: Aplicar tabla de ensayo a los reportes**

En `components/reportes/reportes-view.tsx` y `components/reportes/inventory-reports.tsx`, envolver cada tabla en `<div className="assayTableWrap">`, `className="assayTable"` en `<table>`, y `className="num"` en celdas numéricas.

- [ ] **Step 2: Total subrayado en oro**

Añadir CSS:

```css
.assayTable tfoot td, .assayTable tr.totalRow td {
  border-top: 1px solid var(--gold); font-weight: 600; color: var(--ink);
}
```

Marcar la fila de total con `className="totalRow"`.

- [ ] **Step 3: Encabezado de reporte tipo ficha**

Envolver cada reporte en `.card` con un eyebrow grabado (`<span className="reportEyebrow">`), CSS:

```css
.reportEyebrow { font-family: var(--font-display, sans-serif); text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px; color: var(--muted); }
```

- [ ] **Step 4: Verificar export**

Confirmar que los botones de export (PDF/Excel/CSV) existentes siguen funcionando y usan copy en voz del sistema ("Exportar PDF"). Sin cambio de lógica.

- [ ] **Step 5: Typecheck y revisión visual**

Run: `docker compose exec -T web npx tsc --noEmit`
Expected: exit 0. Reportes: tablas mono, totales con línea de oro, cabecera de ficha.

- [ ] **Step 6: Commit y push**

```bash
git add frontend/components/reportes/reportes-view.tsx frontend/components/reportes/inventory-reports.tsx frontend/app/globals.css
git commit -m "feat(ui): reportes como ficha de ensayo con totales en oro"
git push origin main
```

---

## Self-Review

- **Cobertura del spec:** tokens (T1), tipografía (T1), signature de calibre (T2, usada en T6/T7), punzón de estado (T3), chrome/sidebar/tarjeta (T4), login (T5), dashboards (T6), inventario (T7), reportes (T8). Piso de calidad (responsive `overflow-x`, foco, reduced-motion) presente en las reglas. Sin gaps.
- **Placeholders:** cada paso trae CSS/código real. Los pasos "verificar nombres de campo" (T7 Step 3) apuntan a `lib/inventory-api.ts` para resolver contra tipos reales — no es placeholder de diseño sino verificación necesaria.
- **Consistencia de tipos:** `CaliperScale` y `StatusPunch` con firmas idénticas en definición (T2/T3) y uso (T6/T7/T8).

## Execution Handoff

Al ejecutar, elegir enfoque de ejecución (subagent-driven recomendado).

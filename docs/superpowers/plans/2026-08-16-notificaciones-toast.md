# Notificaciones con Estilo ToastNotice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Los avisos de éxito/error dentro del modal de Acta ("Solicitud
enviada. Inventario debe aprobarla.", "Solo hay 400,00 l de "insumo test"
sin registrar.") salen como texto plano en vez del componente de
notificación (`ToastNotice`) que ya usa el resto del sistema (Inventario,
Mantenimientos, Producción). Causa: esos tres sitios usan la clase CSS
`.processFlowCallout` a secas — una clase pensada para callouts persistentes
de decisión de etapa (`processFlowCalloutCheck`/`processFlowCalloutRework`),
que sin su modificador no trae fondo ni borde, solo texto con color inline.

**Architecture:** No se toca CSS ni se crea nada nuevo — `ToastNotice`
(`frontend/components/ui/toast-notice.tsx`) ya existe y ya se usa en
`inventory-dashboard.tsx`, `production-dashboard.tsx` y los managers de
Mantenimientos con el patrón `<div className="toastStack"><ToastNotice
compact .../></div>`. Se reemplazan los 3 usos incorrectos por ese mismo
patrón.

**Tech Stack:** Next.js 16 App Router, React 18, TypeScript. Sin
dependencias nuevas.

## Global Constraints

- No hay test runner en frontend (confirmado: `package.json` no tiene
  `test`/`jest`/`vitest`). La verificación es `docker-compose exec web npm
  run build` (type-check) + revisión manual en el navegador — no se inventa
  infraestructura de test nueva (CLAUDE.md: no agregar dependencias sin
  pedirlo).
- No tocar `production-dashboard.tsx:3072` (el callout de "Merma de esta
  fase") — ese es un dato persistente, no una notificación de resultado de
  acción; no es lo que Rodrigo reportó y convertirlo a toast sería un cambio
  de comportamiento no pedido.
- `ToastNotice` requiere `onClose: () => void` — cada sitio debe tener (o
  ganar) una forma de limpiar su propio estado de error/success.

---

### Task 1: `ActaView` — banner de error/éxito

**Files:**
- Modify: `frontend/components/production/acta-view.tsx:1-11` (imports)
- Modify: `frontend/components/production/acta-view.tsx:411-420`

**Interfaces:**
- Consumes: `ToastNotice` de `@/components/ui/toast-notice` (`kind: "success" | "error"`, `message: string`, `onClose: () => void`, `compact?: boolean`).

- [ ] **Step 1: Agregar el import**

En `frontend/components/production/acta-view.tsx`, junto a los demás
imports (línea 1-10):

```tsx
import { ToastNotice } from "@/components/ui/toast-notice";
```

- [ ] **Step 2: Reemplazar el banner**

Ubicar dentro de `ActaView` (línea 411-420):

```tsx
        {error ? (
          <div className="processFlowCallout" style={{ color: "var(--danger, #b42318)" }}>
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="processFlowCallout" style={{ color: "var(--success, #1a7f37)" }}>
            {success}
          </div>
        ) : null}
```

Reemplazar por:

```tsx
        {error || success ? (
          <div className="toastStack" aria-live="polite" aria-atomic="true">
            {error ? <ToastNotice key={error} kind="error" message={error} onClose={() => setError(null)} compact /> : null}
            {success ? <ToastNotice key={success} kind="success" message={success} onClose={() => setSuccess(null)} compact /> : null}
          </div>
        ) : null}
```

(`setError`/`setSuccess` ya existen en `ActaView` — son los mismos que usan
`flagError`/`flagSuccess` un poco más abajo en el mismo componente, no hace
falta crearlos.)

- [ ] **Step 3: Type-check**

Run: `docker-compose exec web npm run build`
Expected: `Compiled successfully`, sin errores de TypeScript en
`acta-view.tsx`.

- [ ] **Step 4: Verificación manual**

Con el dev server corriendo, abrir Producción → una orden `EN_PROCESO` →
"Ver Acta" → "Solicitar material" → completar y enviar. Confirmar que
"Solicitud enviada. Inventario debe aprobarla." sale con el estilo de
notificación flotante (fondo, borde, botón de cerrar) igual que los avisos
de Inventario, no como texto suelto.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/production/acta-view.tsx
git commit -m "$(cat <<'EOF'
fix(production): usa ToastNotice en el banner de exito/error del acta

ActaView mostraba error/success con .processFlowCallout a secas --
clase sin fondo ni borde pensada para otro uso (callouts de decision
de etapa) -- en vez del componente ToastNotice que ya usa el resto del
sistema. Salia como texto plano en vez de notificacion.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `ReturnCandidatesForm` — error de "sobrante"

**Files:**
- Modify: `frontend/components/production/acta-view.tsx:239-243`

**Interfaces:**
- Consumes: `ToastNotice` (mismo import que Task 1, ya en el archivo).

- [ ] **Step 1: Reemplazar**

Dentro de `ReturnCandidatesForm` (línea 239-243):

```tsx
      {localError ? (
        <div className="processFlowCallout" style={{ color: "var(--danger, #b42318)", marginTop: 10 }}>
          {localError}
        </div>
      ) : null}
```

Reemplazar por:

```tsx
      {localError ? (
        <div className="toastStack" aria-live="polite" style={{ marginTop: 10 }}>
          <ToastNotice kind="error" message={localError} onClose={() => setLocalError(null)} compact />
        </div>
      ) : null}
```

(`setLocalError` ya existe en `ReturnCandidatesForm`, es el mismo estado que
ya limpia `handleConfirm`.)

- [ ] **Step 2: Type-check**

Run: `docker-compose exec web npm run build`
Expected: `Compiled successfully`.

- [ ] **Step 3: Verificación manual**

Abrir "Ver Acta" en una orden con complemento/insumo entregado → "Devolver
sobrante" → elegir un material → escribir una cantidad mayor a la
disponible → confirmar. El mensaje "Solo hay X sin registrar." debe salir
como notificación (no texto plano), y el botón de cerrar debe funcionar.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/production/acta-view.tsx
git commit -m "$(cat <<'EOF'
fix(production): usa ToastNotice en el error de devolver sobrante

Mismo patron que el commit anterior (ActaView): ReturnCandidatesForm
mostraba su error de validacion ("Solo hay X sin registrar") con
.processFlowCallout a secas en vez de ToastNotice.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `MaterialCategoryPicker` — error del picker compartido

**Files:**
- Modify: `frontend/components/production/material-category-picker.tsx:28-66` (props)
- Modify: `frontend/components/production/material-category-picker.tsx:131-135`
- Modify: `frontend/components/production/acta-view.tsx` (único caller que pasa `error` hoy)

**Interfaces:**
- Consumes: `ToastNotice`.
- Produces: nueva prop opcional `onDismissError?: () => void` en
  `MaterialCategoryPicker` — los otros dos callers (`production-dashboard.tsx`,
  `create-order-wizard.tsx`) no pasan `error` hoy, así que no se ven
  afectados y no necesitan cambios.

- [ ] **Step 1: Agregar el import**

En `frontend/components/production/material-category-picker.tsx`, junto a
los imports existentes:

```tsx
import { ToastNotice } from "@/components/ui/toast-notice";
```

- [ ] **Step 2: Agregar la prop `onDismissError`**

En la firma de `MaterialCategoryPicker` (línea 28-66), agregar el
parámetro y su tipo junto a `error`:

```tsx
  error,
  onDismissError,
}: {
  // ...resto de props sin cambios...
  // Error de validacion/guardado del paso de cantidad: se muestra aqui mismo
  // (la ventana se queda abierta esperando el valor correcto), no en un
  // banner lejano fuera de la vista.
  error?: string | null;
  // Como limpiar `error` cuando el usuario cierra el aviso a mano -- si no
  // viene, el boton de cerrar del aviso no hace nada (el caller sigue
  // controlando `error` por su cuenta, ej. lo limpia solo al reintentar).
  onDismissError?: () => void;
}) {
```

- [ ] **Step 3: Reemplazar el render del error**

Línea 131-135:

```tsx
        {error ? (
          <div className="processFlowCallout" style={{ color: "var(--danger, #b42318)", marginTop: 10 }}>
            {error}
          </div>
        ) : null}
```

Reemplazar por:

```tsx
        {error ? (
          <div className="toastStack" aria-live="polite" style={{ marginTop: 10 }}>
            <ToastNotice kind="error" message={error} onClose={() => onDismissError?.()} compact />
          </div>
        ) : null}
```

- [ ] **Step 4: Actualizar el caller que pasa `error` (`EntregaAction` en acta-view.tsx)**

En `frontend/components/production/acta-view.tsx`, dentro de
`EntregaAction`, ubicar el `<MaterialCategoryPicker ... error={localError}
.../>` (línea ~77-109) y agregar la nueva prop:

```tsx
        <MaterialCategoryPicker
          allowedTypes={["RAW_MATERIAL", "SUPPLY", "COMPLEMENT"]}
          description="Elige el material que necesitas pedir para esta orden"
          error={localError}
          items={materialItems}
          onClose={closePicker}
          onDismissError={() => setLocalError(null)}
          onSelect={(item) => {
            setPendingItem(item);
            setQuantity("");
            setLocalError(null);
          }}
          quantityStep={
            // ...sin cambios...
          }
          title="Solicitar material"
        />
```

- [ ] **Step 5: Type-check**

Run: `docker-compose exec web npm run build`
Expected: `Compiled successfully` — confirma que los otros dos callers
(`production-dashboard.tsx:3860`, `create-order-wizard.tsx:364`) siguen
compilando sin pasar la prop nueva (es opcional).

- [ ] **Step 6: Verificación manual**

Abrir "Ver Acta" en una orden `EN_PROCESO` → "Solicitar material" → elegir
un material → dejar la cantidad vacía → confirmar. El error "Elige el
material y su cantidad." debe salir como notificación con botón de cerrar
funcional.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/production/material-category-picker.tsx frontend/components/production/acta-view.tsx
git commit -m "$(cat <<'EOF'
fix(production): usa ToastNotice en el error de MaterialCategoryPicker

Mismo patron, tercer y ultimo sitio: el picker compartido de
materiales mostraba su error de validacion como texto plano. Se
agrega onDismissError (opcional) para que el boton de cerrar del
ToastNotice funcione sin forzar a los otros callers del picker
(que hoy no usan `error`) a cambiar nada.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Verificación final del plan

- [ ] **Step 1: Build completo**

Run: `docker-compose exec web npm run build`
Expected: `Compiled successfully`, las 12 rutas listadas sin error.

- [ ] **Step 2: Volver al plan maestro**

Marcar el checkbox de este plan en
`docs/superpowers/plans/2026-08-16-acta-bugs-master.md` y abrir el siguiente
plan de la lista (Totales del acta) sin esperar confirmación adicional.

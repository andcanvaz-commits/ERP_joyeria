# Decisiones / Control de calidad con retorno de flujo — diseño

**Fecha:** 2026-06-30

## Problema

Las etapas de `DECISION` y `CONTROL` (control de calidad) tienen una pregunta
(`quality_check`) y un texto de reproceso (`rework_action`), pero el sistema no permite
una decisión real: hoy "✓ Aprobado" y "✗ No cumple" **ambos finalizan y avanzan igual**,
`CONTROL` no se maneja, y no hay justificación, destino de retorno ni historial.

## Objetivo

Permitir al jefe de producción **aprobar o rechazar** una etapa de decisión/control,
justificar el rechazo (manual o derivado del peso), registrar cada intento y, en una
negativa, **volver el flujo a la etapa configurada**.

## Decisiones (confirmadas)

- Retorno en rechazo: **destino fijo configurado por etapa** (`rework_target_order`).
- Disparo: etapas tipo **DECISION/CONTROL** **o** con `quality_check` no vacío.
- Justificación: **manual + auto del peso** cuando aplica.
- Historial: **se registra cada intento** (auditoría/trazabilidad).

## Backend

### Modelos (`backend/modules/production/models.py`)
- `ProductionProcessStage`: + `rework_target_order: int | None`.
- `ProductionRunStage`: + `rework_target_order: int | None` (copiado al generar la orden).
- Nueva tabla `ProductionRunStageDecision`:
  `id, run_id, run_stage_id, decision ('APPROVED'|'REJECTED'), justification (text|null),
  weight_based (bool), final_weight (numeric|null), returned_to_order (int|null),
  decided_by_user_id (uuid|null), decided_at (timestamptz), attempt_no (int)`.

### Migración (`backend/app/main.py`, patrón existente)
- `ALTER TABLE production_process_stages ADD COLUMN IF NOT EXISTS rework_target_order INTEGER`
- `ALTER TABLE production_run_stages ADD COLUMN IF NOT EXISTS rework_target_order INTEGER`
- `CREATE TABLE IF NOT EXISTS production_run_stage_decisions (...)`

### Esquemas (`schemas.py`)
- `ProductionProcessStageWrite`/`Read`: + `rework_target_order: int | None`.
- `ProductionRunStageFinish`: + `decision: 'APPROVED' | 'REJECTED' | None`,
  `justification: str | None`.
- `ProductionRunStageRead`: + `rework_target_order`, + `decisions: list[StageDecisionRead]`.
- `StageDecisionRead`: decision, justification, weight_based, final_weight,
  returned_to_order, decided_by_name, decided_at, attempt_no.

### Servicio (`service.py`)
- Al generar la orden (create_run): copiar `rework_target_order` a cada run stage.
- `finish_stage(stage_id, payload, current_user)`:
  - `requiere_decision = stage.stage_type in {DECISION, CONTROL} or bool(stage.quality_check)`.
  - Auto-justificación por peso: si `requires_weighing` y hay `initial_weight`/`final_weight`
    y `(inicial − final)/inicial · 100 > run.waste_limit_percent` →
    `auto = "Pérdida de peso {p}% supera el límite {limite}%"`.
  - `attempt_no` = nº de decisiones previas de esa etapa + 1.
  - Si `requiere_decision` y `decision is None` → error "Selecciona aprobar o rechazar."
  - **APPROVED**: registrar decisión (justification opcional); finalizar etapa
    (`finished_by_user_id`), avanzar a la siguiente o finalizar la orden (como hoy).
  - **REJECTED**:
    - `justification = payload.justification or auto`; si ambos vacíos → error
      "Justifica el rechazo."
    - `target = stage.rework_target_order or (stage_order − 1) or stage_order` (default:
      etapa anterior; si es la primera, repetir la misma).
    - Registrar decisión (REJECTED, justification, weight_based, returned_to_order=target).
    - Reset de flujo: etapas con `stage_order >= target` → PENDIENTE (limpiar
      started_at/finished_at/weights de las posteriores al destino); la etapa destino →
      EN_PROCESO con `started_at = now`. La orden sigue EN_PROCESO. **No** avanza.
  - Para etapas sin decisión: comportamiento actual (finalizar y avanzar).
- Resolver `decided_by_name` con `_resolve_run_user_names`; incluir decisiones en los reads.

## Frontend

### Editor de proceso (`production-dashboard.tsx`, form de etapas)
- Para etapas con `stage_type` DECISION/CONTROL o `quality_check` no vacío: selector
  **"Volver a etapa (en rechazo)"** que lista las etapas anteriores (orden + nombre) →
  guarda `rework_target_order`. Default vacío = etapa anterior.

### Finalizar etapa (modal de etapas de la orden)
- Si la etapa requiere decisión:
  - **Aprobar** → `finish(decision=APPROVED, final_weight?)`.
  - **Rechazar** → abre justificación (textarea) pre-llenada con la razón del peso si
    aplica; obligatoria; `finish(decision=REJECTED, justification, final_weight?)`.
- Etapas normales: igual que hoy.

### Línea de tiempo
- Mostrar por etapa el **historial de intentos** (decisión, justificación, cuenta, fecha,
  nº de intento) bajo la tarjeta de la etapa.

### Tipos (`types/production`)
- `ProductionProcessStage` / `ProductionRunStage`: + `rework_target_order?: number | null`.
- `ProductionRunStage`: + `decisions?: StageDecision[]`.
- Payload de finish: + `decision?`, `justification?`.

## No-objetivos
- No se cambia el cálculo de merma ni el flujo inventario/recepción.
- No se reordenan etapas automáticamente; el destino lo fija el editor.

## Criterios de aceptación
- Etapa DECISION/CONTROL (o con quality_check) exige aprobar/rechazar.
- Rechazar exige justificación (o la deriva del peso) y devuelve el flujo a la etapa
  configurada; la orden sigue en proceso.
- Cada intento queda registrado y visible en la línea de tiempo.
- Aprobar avanza normal. Backend arranca y frontend compila.

# Acta / Producción — Lista Maestra de Bugs Implementation Plan

> **For agentic workers:** Este documento NO se ejecuta directo — es el índice
> que abre cada plan individual, en orden. Cada plan hijo trae su propio header
> con REQUIRED SUB-SKILL (superpowers:subagent-driven-development o
> superpowers:executing-plans). Al terminar un plan hijo (todas sus tasks en
> `[x]`, tests/build verdes, commit hecho), marcar su checkbox aquí abajo y
> abrir el siguiente sin pedir confirmación adicional — es el mismo flujo que
> ya se usó hoy: implementar, testear, commitear, seguir.

**Goal:** Resolver los 6 problemas reportados por Rodrigo el 2026-08-16 sobre
el acta de producción (notificaciones con estilo incorrecto, totales mal
sumados, formato de decimales en errores, y el flujo de devolución de
complementos/insumos al finalizar producción), en una sola sesión de trabajo
continua.

**Contexto (no repetir en los planes hijos):** Todo lo reportado ese día se
investigó a fondo antes de escribir estos planes — código leído, causa raíz
confirmada en cada caso (no hay ningún punto que dependa de "probar a ver qué
pasa"), y para el único punto ambiguo (fórmula de "sobrante" de complementos)
ya se le preguntó a Rodrigo y confirmó la regla exacta: `usado = aprobado -
devuelto`, siempre, sin importar en qué momento se registra la devolución.

## Orden de ejecución

Ordenado de menor a mayor riesgo/alcance — cada uno es independiente,
completo y testeado antes de pasar al siguiente:

- [x] **1. [Formato de decimales en errores](2026-08-16-formato-decimales-errores.md)**
      — el más aislado, cero riesgo de UX, toca solo backend.
- [x] **2. [Notificaciones con estilo ToastNotice](2026-08-16-notificaciones-toast.md)**
      — solo frontend, mismo componente que ya usa el resto del sistema.
- [x] **3. [Totales del acta (Total entregado/recibido)](2026-08-16-acta-totales.md)**
      — un solo archivo (`orden-produccion.ts`), lógica pura, bien acotado.
- [x] **4. [Modal "Sobrante por devolver" al finalizar](2026-08-16-modal-sobrante-devolver.md)** (código completo; su verificación manual E2E queda pendiente de Rodrigo)
      — el de mayor impacto funcional (afecta inventario real vía
      `return_complement`), se deja al final con la cabeza más fresca.

## Qué cubre cada uno (mapeo al reporte original de Rodrigo)

| Reporte de Rodrigo | Plan | Causa raíz confirmada |
|---|---|---|
| Notificaciones en modales salen como texto plano | 2 | `acta-view.tsx` y `material-category-picker.tsx` usan `.processFlowCallout` a secas (clase pensada para otra cosa, sin fondo/borde) en vez del componente `ToastNotice` que ya usa el resto del sistema |
| "Total recibido" se ve quemado, no se recalcula | 3 | Es el mismo bug que la fila de abajo — la fórmula nunca dependía de las devoluciones, por eso no cambiaba al registrar una |
| Decimales de sobra en mensajes de error (`400.0000 g`) | 1 | `Decimal` de columnas `Numeric(14,4)` interpolado directo en f-strings, sin formatear |
| Modal de sobrante: label mal planteado | 4 | Texto fijo en `production-dashboard.tsx`, cambio de copy |
| Modal de sobrante: no ofrece complementos aunque sobre | 4 | `remaining` se calculaba como `aprobado - usado_por_ensamble - devuelto`; el ensamble automático marca el 100% como "usado" al finalizar, dejando `remaining` en 0 o negativo siempre — se quita `usado` de la cuenta por completo, en backend y frontend |
| Sumatorias de "Total entregado"/"Total recibido" no cuadran | 3 | Solo sumaba la línea de materia prima por `item_id`, ignorando complementos con la misma unidad |

## Al terminar TODOS los planes

- `docker-compose exec api pytest` (suite completa, no solo los módulos tocados)
- `docker-compose exec web npm run build`
- Confirmar con Rodrigo en el navegador: abrir una orden real con complemento
  devuelto parcialmente y revisar que el acta impresa (Documentos) se vea
  consistente con Ver Acta — ambas comparten `buildRunActaSides`/
  `buildFamilyActaSides`, así que un solo chequeo cubre las dos vistas.

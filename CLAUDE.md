# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ERP web para una joyería: producción, inventario, merma, documentos, reportes y
seguridad. UI y dominio son **español-first** (labels, mensajes de error y
nombres de estado en español); el código es inglés salvo los valores de enum del
dominio, que son español (`EN_PROCESO`, `CONSUMO_PRODUCCION`, …).

La especificación funcional original (alcance deseado, no estado actual) está en
[docs/ESPECIFICACION_FUNCIONAL.md](docs/ESPECIFICACION_FUNCIONAL.md).

## Comandos

Todo corre en Docker; no hay entorno Python/Node local esperado.

```powershell
copy .env.example .env      # una vez; define POSTGRES_PASSWORD y ambos secretos JWT
docker-compose up --build   # web :3000, api :8001 (host) -> :8000 (contenedor), db :5435
docker-compose logs -f api
```

```powershell
# Backend
docker-compose exec api pytest                                   # suite completa
docker-compose exec api pytest backend/tests/production           # un directorio
docker-compose exec api pytest backend/tests/production/test_material_split.py::test_nombre
docker-compose exec api python -m compileall backend              # chequeo rápido de sintaxis
docker-compose exec api alembic revision -m "descripcion"         # nueva migración
docker-compose exec api alembic upgrade head                      # el arranque ya lo hace

# Frontend
docker-compose exec web npm run lint
docker-compose exec web npm run build
```

Los tests **necesitan la base PostgreSQL viva**: la fixture `db_session`
([backend/tests/conftest.py](backend/tests/conftest.py)) abre una transacción
real contra `settings.database_url` y hace rollback al final, así que nunca deja
datos. No hay SQLite ni base en memoria.

## Arquitectura

```text
Navegador → Next.js (rewrite /api/*) → FastAPI (/api/...) → PostgreSQL
```

En dev el navegador habla solo con Next (mismo origen) y
[frontend/next.config.mjs](frontend/next.config.mjs) reenvía `/api/*` al backend;
en producción nginx hace ese ruteo. Por eso la cookie HttpOnly funciona sin
cross-site y `NEXT_PUBLIC_API_URL` va vacío.

### Backend — módulos verticales

La estructura real es `backend/modules/<modulo>/` (no la de `app/api/v1/` que
sugiere la especificación). Cada módulo trae hasta cinco archivos con
responsabilidad fija:

| archivo | responsabilidad |
|---|---|
| `models.py` | SQLAlchemy 2.0 `Mapped[...]`, UUID PK, `Numeric(14,4)` para pesos/cantidades |
| `schemas.py` | Pydantic v2 de entrada/salida |
| `service.py` | **toda** la lógica de negocio y las validaciones de dominio |
| `repository.py` | acceso a datos (solo `inventory` y `production`) |
| `router.py` | endpoints; traduce excepciones de dominio a HTTP |

Módulos: `auth`, `catalog`, `config`, `database`, `inventory`, `product_types`,
`production`, `security`, `shared`, `units`. Los routers se montan en
[backend/app/main.py](backend/app/main.py) bajo `/api/auth`, `/api/production`,
`/api/inventory`, `/api/catalog`, `/api/product-types`, `/api/units`.

Convenciones que se repiten en todos los routers y hay que respetar:

- El `get_*_service()` de cada router **es** la unidad transaccional: abre
  `SessionLocal()`, hace `yield`, `commit()` al terminar bien y `rollback()` ante
  cualquier excepción. Los services usan `flush()`, no `commit()`.
- Cada endpoint llama `ensure_permission(current_user, "modulo.recurso.accion")`
  antes de tocar el service.
- Los services levantan `<Modulo>DomainError` (→ 409) y `<Modulo>NotFoundError`
  (→ 404); el router los mapea. Nunca lanzar `HTTPException` desde un service.
- `production` habla con `inventory` por inyección de `InventoryService`; el
  contrato está en
  [backend/modules/shared/contracts/inventory.py](backend/modules/shared/contracts/inventory.py).
  No importar modelos de otro módulo al nivel de módulo — se hace import local
  dentro de la función para evitar ciclos (patrón ya usado en todo el código).

### Frontend

Next.js 16 App Router, React 18, TypeScript. **No hay Tailwind, ni Zod, ni React
Hook Form, ni TanStack Table, ni Recharts**, pese a lo que diga la
especificación: las únicas dependencias son `@tanstack/react-query`,
`lucide-react` y Next/React. Los gráficos son SVG propios
([category-donut.tsx](frontend/components/shared/category-donut.tsx),
[ranked-bar-chart.tsx](frontend/components/shared/ranked-bar-chart.tsx)). No
agregues dependencias sin pedirlo.

El estilo vive **entero** en [frontend/app/globals.css](frontend/app/globals.css)
(~4.8k líneas) con tokens CSS: paleta papel+oro (`--paper`, `--gold-deep`,
`--silver`), escala `--space-1..8`, `--shadow`/`-2`/`-3`. Usa clases y tokens
existentes antes de escribir CSS nuevo.

Cada ruta de `frontend/app/(app)/<modulo>/page.tsx` es un cascarón que monta un
dashboard de `frontend/components/<modulo>/`. Los dos grandes
([inventory-dashboard.tsx](frontend/components/inventory/inventory-dashboard.tsx)
~5.1k líneas y
[production-dashboard.tsx](frontend/components/production/production-dashboard.tsx)
~4k) concentran casi toda la UI operativa.

Las llamadas HTTP pasan siempre por `apiRequest()` de
[frontend/lib/api.ts](frontend/lib/api.ts), que adjunta el token CSRF, traduce
errores de FastAPI a mensajes en español y redirige a `/login` ante 401. Los
módulos exponen su propio `lib/*-api.ts`; los componentes no llaman `fetch`
directo.

La navegación por rol se decide en [frontend/lib/roles.ts](frontend/lib/roles.ts)
(solo cosmética — el permiso real lo impone el backend).

Antes de tocar frontend, lee la skill del proyecto
[.claude/skills/erp-jewelry-web-design/SKILL.md](.claude/skills/erp-jewelry-web-design/SKILL.md).

## Reglas de dominio innegociables

1. **Nada de procesos ni etapas quemados en código.** Los procesos, sus etapas,
   el orden, los tipos de etapa y las materias primas asociadas son datos en
   PostgreSQL, editables por el admin. `EXAMPLE_PROCESSES` en
   [production/service.py](backend/modules/production/service.py) es solo semilla
   de desarrollo. Lo mismo aplica a nombres de material, categorías y modelos:
   viven en `catalog_segments` y `product_types`.
2. **El stock jamás se edita a mano.** Todo cambio de `current_stock` nace de un
   `InventoryMovement`. `create_movement()` es el único lugar que aplica el
   delta; `POSITIVE_MOVEMENTS` / `NEGATIVE_MOVEMENTS` definen el signo. Las
   conversiones y reclasificaciones se hacen como par SALIDA+ENTRADA, nunca
   moviendo un número.
3. **No existe "empleado responsable"** en la orden. El responsable es el usuario
   autenticado que ejecuta cada transición (`created_by_user_id`,
   `materials_approved_by_user_id`, `received_by_user_id`, …). Los campos
   `*_responsable_name` son texto libre y existen **solo** para órdenes
   históricas importadas de papel, sin cuenta de usuario.
4. **Los permisos se validan en el backend.** El frontend solo oculta.
5. **Esquema por Alembic.** Toda columna nueva necesita su migración en
   `backend/alembic/versions/`.

## Flujo de producción (máquina de estados real)

`ProductionRunStatus` en
[production/models.py](backend/modules/production/models.py):

```text
PENDIENTE_INVENTARIO ──approve_materials──> MATERIALES_APROBADOS ──start_run──> EN_PROCESO
        │                                                                          │
        │ reject_materials → CANCELADA                                   finish_stage (última)
        │                                                                          ↓
        └─ split por falta de stock → ESPERANDO_MATERIAL                  PENDIENTE_RECEPCION
                       │                                                           │
                       └── allocate_material (inventario destina un ingreso) ───────┘
                           → aprueba + inicia automáticamente        receive_finished_product
                                                                                   ↓
                                                                               RECIBIDA
```

Puntos que sorprenden si no se leen antes:

- **Split por material parcial.** `approve_materials` calcula cuántas unidades
  cubre el recurso más corto (materia prima *y* cada complemento pedido, el
  mínimo de ambos). La porción cubierta sigue su curso; el remanente se parte en
  una corrida hija en `ESPERANDO_MATERIAL`, bajo el mismo `root_production_code`
  y con sufijo (`OP-2026-0001-B`, `-C`). Las corridas hijas **no** entran en la
  cola normal de aprobación: solo despiertan por `allocate_material`.
- La merma se registra **por etapa** (`ProductionRunStage.waste_weight`) y la
  merma total de la orden es su suma; el porcentaje se calcula sobre
  `total_required_material`.
- Las etapas se **copian** del proceso a la corrida al crearla, para que editar
  el proceso no altere el historial.
- Las etapas `CONTROL`/`DECISION` generan `ProductionRunStageDecision` y pueden
  devolver el flujo a una etapa anterior (`rework_target_order`).
- **Ensamble.** Modo `ASIGNAR` (split directo) o `ENSAMBLAR` (con complementos).
  Al terminar, si hay una `AssemblyRecipe` para el `model_key` y los complementos
  aprobados alcanzan, se aplica sola; si no, `assembly_pending=True` y producción
  debe definirla antes de que inventario pueda recibir.
- **Recepción.** `receive_finished_product` crea un lote `FINISHED_PRODUCT` cuyo
  SKU es el código OP, y —si la orden declaró productos resultantes— lo convierte
  ahí mismo a productos del catálogo. Las corridas con `event_lines` (importadas
  de actas de papel) rechazan este flujo: recibirlas generaría movimientos de
  inventario que el papel nunca respaldó.

## Códigos y numeración

| qué | formato | dónde |
|---|---|---|
| Orden de producción | `OP-2026-0001`, hijas `-B`/`-C` | `_generate_production_code` |
| Etapa de corrida | `FUN-OP0001-01` (3 letras + corrida + orden) | `_stage_code_for` |
| Proceso | `2000`, `2001`, … | `_next_process_code` |
| Item de inventario | prefijo por tipo: `MP` materia prima, `IN` insumo, `CO` complemento, `PP` en proceso, `PT` terminado, `ME` merma | `ITEM_TYPE_PREFIXES` |
| Producto de catálogo | 7 dígitos = material(1) + categoría(2) + modelo(4) | `catalog_segments` + `product_types` |
| Receta de ensamble | `model_key` = ese código de 7 dígitos completo | `AssemblyRecipe.model_key` |

El `model_key` incluye el dígito de material a propósito: oro y plata del mismo
modelo tienen recetas distintas.

## Inventario

- `item_type`: `RAW_MATERIAL`, `SUPPLY`, `COMPLEMENT`, `WORK_IN_PROGRESS`,
  `FINISHED_PRODUCT`, `WASTE`. Solo los cuatro de `MANUALLY_MANAGED_TYPES` los
  crea el usuario; el resto los administra producción.
- `average_cost` es costo promedio ponderado, recalculado en cada ENTRADA.
- `revert_last_entry` solo funciona dentro de `INVENTORY_REVERT_WINDOW_HOURS`
  (24 por defecto); pasada la ventana el movimiento es inmutable y solo procede
  un ajuste.
- `archived_at` oculta items agotados sin perder historial; una entrada nueva los
  desarchiva.
- Los items de producto terminado se consolidan por código + nombre +
  descripción + material: la trazabilidad por lote vive en los movimientos
  (`lot_code`, `source_lot_sku`), no en filas separadas.

## Auth y seguridad

- JWT en **cookie HttpOnly** `access_token`; el header `Authorization` es solo
  fallback para clientes no-web. `localStorage` guarda únicamente una bandera no
  sensible de "sesión iniciada".
- **CSRF double-submit**: middleware en `main.py` exige `X-CSRF-Token` igual a la
  cookie `csrf_token` en todo método que muta bajo `/api` (excepto el login, que
  es quien siembra la cookie). `apiRequest()` ya lo adjunta.
- Los permisos **derivan del rol** en cada login: `ROLE_PERMISSIONS` en
  [auth/service.py](backend/modules/auth/service.py) es la fuente de verdad y
  reescribe los permisos del usuario si cambiaron. Roles del sistema: `Admin`,
  `Jefe de producción`, `Jefe de inventario` (ojo con la tilde y las variantes
  que ya tolera `ensure_permission`).
- `Settings._enforce_production_hardening` **rompe el arranque** en
  `APP_ENV=production` si los secretos son débiles o iguales entre sí, si faltan
  `CORS_ORIGINS`/`ALLOWED_HOSTS`/`SEED_ADMIN_PASSWORD`, o si `ENABLE_DOCS=true`.

## Migraciones y arranque

`docker-compose` corre `alembic upgrade head` antes de uvicorn. Además el startup
de `main.py` ejecuta `upgrade_*_table()`: una tanda de
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` **solo en desarrollo**, para curar
bases viejas creadas con `create_all` y luego selladas por Alembic. No es un
sustituto de las migraciones: si agregas una columna, escribe la migración; el
bloque de `main.py` es deuda técnica de compatibilidad, no el mecanismo oficial.

Semillas en el arranque: el admin y las unidades de medida **siempre**
(idempotentes); los procesos de ejemplo y el catálogo solo si
`SEED_ON_STARTUP=true` (dev).

## Al terminar un cambio

- Backend tocado → `docker-compose exec api pytest` y, si aplica, la migración.
- Frontend tocado → `docker-compose exec web npm run build`.
- Si el cambio afecta dependencias, puertos, scripts o variables de entorno,
  actualiza `Dockerfile`/`docker-compose*.yml`/`.env.example`/`README.md` en la
  misma sesión.

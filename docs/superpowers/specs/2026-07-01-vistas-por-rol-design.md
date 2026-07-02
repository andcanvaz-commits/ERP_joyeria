# Vistas por rol — Producción e Inventario

Fecha: 2026-07-01

## Objetivo

Cada usuario no-admin ve únicamente las secciones que le corresponden. El backend
ya autoriza por rol/permiso en cada endpoint; esta función añade la capa visual
(nav filtrado) y guard de rutas en el frontend, más contenido específico por rol
en Dashboard y Reportes, y una página de Solicitudes.

## Roles

- `Admin`: acceso completo (sin cambios).
- `Jefe de producción` (acento y sin acento se tratan igual).
- `Jefe de inventario`.

## Secciones por rol

| Sección | Admin | Producción | Inventario |
|---|:-:|:-:|:-:|
| Dashboard | full | solo producción | solo inventario |
| Producción | sí | sí | no |
| Inventario | sí | no | sí |
| Solicitudes | sí | enviadas | recibidas |
| Reportes | sí | producción | inventario |
| Documentos | sí | sí | sí |
| Codificación | sí | no | no |
| Mantenimientos | sí | no | no |
| Seguridad (menú perfil) | sí | sí | sí |

Home por rol (destino de redirección del guard): admin → `/dashboard`,
producción → `/produccion`, inventario → `/inventario`.

## Componentes

1. **`frontend/lib/roles.ts`**: normaliza el string de rol (acento), expone
   `isAdmin/isProduction/isInventory`, la lista de nav por rol y `canAccess(role, path)`.
2. **`app-shell.tsx`**: nav dinámico por rol; guard que redirige al home del rol
   cuando la ruta actual no está permitida. Mantiene el guard de `must_change_password`.
3. **Dashboard** (`system-dashboard.tsx`): ramas por rol. Producción: procesos y
   corridas. Inventario: resumen de stock, bajo stock, movimientos. Admin: todo.
   No-admin no llama `listUsers` (evita 403).
4. **Reportes** (`reportes-dashboard.tsx`): producción/admin ven los reportes
   actuales. Inventario ve reportes nuevos (stock actual, stock bajo,
   movimientos/kardex) derivados de `getInventorySummary`, `listInventoryItems`,
   `listInventoryMovements`.
5. **`/solicitudes`** (página + componente nuevos):
   - Producción: sus corridas con estado/seguimiento (solo lectura).
   - Inventario: pendientes de aprobar/rechazar y pendientes de recibir
     (reusa `approveProductionRunMaterials`, `rejectProductionRunMaterials`,
     `receiveProductionRunFinishedProduct`).

## Alcance / no-objetivos

- Sin cambios de esquema de base de datos.
- Backend sin cambios funcionales (los endpoints ya autorizan por rol/permiso).
- No se rediseña el flujo de solicitudes; solo se expone en una vista dedicada.
- La seguridad real sigue en el backend; el filtrado de nav es UX, no control de acceso.

## Verificación

- Login como cada rol muestra solo su nav; acceso manual a ruta ajena redirige.
- Dashboard y Reportes muestran contenido del dominio correcto sin errores 403.
- Solicitudes: producción ve las enviadas; inventario puede aprobar/rechazar/recibir.

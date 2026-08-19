# Especificación de cambios — Sistema de Producción/Inventario

> Documento de trabajo para Claude Code. Contiene fixes puntuales y un rediseño
> estructural de roles, órdenes de producción y actas. Las secciones marcadas
> con **[REVISAR]** son supuestos que tomé para poder avanzar; confírmalos o
> ajústalos antes (o durante) la implementación.

---

## 0. Resumen del cambio

Se elimina la separación entre rol de **Inventario** y rol de **Producción**:
ambos se fusionan en un único rol **Producción/Inventario**. El rol **Admin**
gana la capacidad de enviar solicitudes libres a Inventario. El proceso de
producción deja de ser una secuencia fija de etapas (fundido → laminado →
ensamblaje → etc.) y pasa a ser **dinámico**, armado etapa por etapa desde un
banco de procesos configurable. Las actas dejan de ser una sola por orden y
pasan a ser **una por etapa**, enlazadas a la orden que las originó. El
sistema de **recetas y ensamblaje se elimina** por completo (ya no aplica con
el nuevo flujo).

---

## 1. Fixes normales (prioridad alta, esfuerzo bajo)

### 1.1 Actualización en tiempo real del acta
Al eliminar o editar una línea directamente en el acta, la tabla debe
reflejar el cambio de inmediato en el cliente (optimistic update o
revalidación del query tras la mutación), sin requerir recargar la página.

**Criterio de aceptación:** eliminar/editar una fila → la fila desaparece o
se actualiza visualmente sin refresh manual, y el estado persiste si se
recarga después.

### 1.2 Fechas agrupadas visualmente en la columna "Fecha"
En la tabla del acta, si varias filas consecutivas comparten la misma fecha,
la fecha solo debe mostrarse en la primera celda de ese grupo (rowspan),
dejando las demás celdas de esa columna vacías para esa fecha.

**Criterio de aceptación:**
- Si se agrega/edita/elimina una fila y cambia el agrupamiento, el rowspan se
  recalcula automáticamente (si se borra la única fila que "traía" la fecha
  visible, la siguiente fila del grupo debe heredar el rowspan).
- El orden de filas en el acta debe garantizar que las fechas iguales queden
  contiguas para que el agrupamiento tenga sentido (ordenar por fecha si no
  lo está ya).

---

## 2. Roles

### 2.1 Roles nuevos
- **Admin**: acceso total + nueva capacidad de enviar solicitudes libres.
- **Producción/Inventario**: fusión de los roles actuales de Producción e
  Inventario. Hereda todos los permisos de ambos.

Los roles "Inventario" y "Producción" como entidades separadas dejan de
existir como opción asignable a usuarios nuevos.

**[REVISAR]** ¿Los usuarios que hoy tienen rol "Inventario" o "Producción"
por separado deben migrarse automáticamente al nuevo rol fusionado, o se
reasignan manualmente? Asumo migración automática de ambos roles al nuevo rol
único, conservando su historial de acciones tal cual.

### 2.2 Admin — nueva funcionalidad: mensaje/solicitud libre
- El Admin puede escribir un mensaje de texto libre (no estructurado), ej:
  *"Necesito 20kg de este producto para el 30 de agosto"*.
- Este mensaje se envía a la bandeja de **Solicitudes** del rol
  Producción/Inventario.
- Producción/Inventario puede **Aceptar** o **Rechazar** el mensaje.
- La respuesta (aceptado/rechazado) le debe llegar de vuelta al Admin que lo
  envió (notificación o bandeja de respuestas).
- Este intercambio es el punto de partida informal para que
  Producción/Inventario decida crear (o no) una orden de producción, pero
  **no crea la orden automáticamente** — es solo comunicación.

**[REVISAR]** ¿El mensaje debe quedar visible/con historial permanente
(bandeja de mensajes con fecha, estado, remitente) o es efímero una vez
respondido? Asumo que debe quedar historial completo, igual que las
solicitudes actuales.

### 2.3 Producción/Inventario — cambio de sentido de "Solicitudes"
- La bandeja de **Solicitudes** ahora sirve **únicamente** para los mensajes
  entrantes del Admin (ver 2.2).
- Se elimina la lógica de aprobación de salidas de materia prima para
  órdenes de producción: como el mismo rol crea la orden y maneja el
  inventario, ya no tiene sentido que se autoapruebe. Las salidas/entradas de
  materia prima en el acta ahora son **directas**, sin flujo de aprobación
  previo (ver sección 5, "Actas").

---

## 3. Banco de procesos (Mantenimientos)

- En **Mantenimientos** se crea un banco de procesos (ej: Fundido, Laminado,
  Pulido, Ensamble manual, etc.), reutilizando la misma lógica de
  configuración que ya existe para las etapas actuales.
- Cada proceso del banco es reutilizable entre distintas órdenes.

**[REVISAR]** Campos mínimos que debería tener un proceso en el banco: nombre,
¿descripción?, ¿unidad de medida esperada (peso)?, ¿orden/categoría? Definir
si se reutiliza la tabla de "etapas" existente (renombrándola/generalizándola)
o se crea una tabla nueva `procesos`.

---

## 4. Nuevo flujo de creación de orden de producción

El proceso deja de ser estático. Flujo nuevo:

1. **Crear orden**: se pide un **nombre textual** libre para la orden (ej:
   "Cadenas cubanas lote agosto"). El sistema genera además un **código
   único** de orden (ver sección 8, "Códigos").
2. **Seleccionar proceso**: se elige un proceso del banco (sección 3), ej.
   "Fundido".
   - Vista de la etapa activa: nombre del proceso, campo de **peso al
     finalizar**, e íconos de **✔ / ✘** para aprobar o rechazar y repetir el
     proceso.
   - Al iniciar el proceso se debe ingresar el **nombre del responsable**
     (persona a cargo de esa etapa). Este campo lo llena
     Producción/Inventario.
3. Al finalizar (✔) una etapa, se presentan dos caminos, no excluyentes:
   - **Agregar otra etapa**: repetir el paso 2 con otro proceso del banco.
   - **Asignar a producto terminado**: crear un producto terminado nuevo o
     asignar el resultado a uno existente, disponible **en cualquier etapa**
     del flujo (no solo al final). Esto cubre casos donde el proceso se
     detiene a medio camino y ese resultado parcial (ej. "cadenas
     laminadas") ya se quiere guardar como producto terminado / stock.
4. Si se rechaza (✘) una etapa, **no** se repite necesariamente el mismo
   proceso: se vuelve al paso 2 (selección de proceso) permitiendo elegir un
   proceso distinto y/o un nuevo responsable. Ver confirmación en el bloque
   siguiente.

**Confirmado:** al rechazar (✘) una etapa, Producción/Inventario puede
reasignar tanto el **responsable** como el **proceso** antes de repetir el
paso. Es decir, un rechazo no obliga a repetir el mismo proceso: se vuelve a
la selección de proceso (banco) con la posibilidad de elegir uno distinto y/o
un nuevo responsable.

**[REVISAR]** ¿El rechazo debe pedir un motivo (texto) que quede registrado
para trazabilidad/auditoría de por qué se rechazó esa etapa? Recomendación:
sí, agregar un campo de motivo obligatorio al rechazar.

**[REVISAR]** ¿El flujo es siempre secuencial (una etapa activa a la vez por
orden) o se permiten ramas paralelas dentro de la misma orden (ej. una parte
del lote sigue a laminado y otra se asigna ya como producto terminado)? Asumo
secuencial simple por ahora, con la salida a "producto terminado" como una
posible terminación anticipada de esa rama de la orden.

**[REVISAR]** "Peso al finalizar": ¿es el peso total del lote en esa etapa, o
por unidad? ¿Se compara contra un peso esperado/ingresado al iniciar la etapa
para calcular la merma automáticamente, o la merma se calcula contra el peso
final de la etapa anterior?

---

## 5. Actas (una por etapa)

- Cada etapa de cada orden genera **su propia acta** (ej: acta de Fundido,
  acta de Laminado), en vez de una sola acta por orden.
- Cada acta mantiene la lógica actual de **agregar / devolver** materia
  prima o insumos.
- Producción/Inventario ahora puede operar el acta **directamente**, igual
  que el Admin (sin flujo de aprobación intermedio — ver 2.3).
- **Fix de reutilización de vista**: el botón "Devolver" no aparece hoy para
  el Admin en su vista de acta; al reutilizar esa lógica para esta nueva
  vista de Producción/Inventario, corregir ese bug para que "Devolver" sí
  aparezca donde corresponda.
- **Formulario de ingreso manual**: en vez de mostrarse inline en la misma
  página, debe abrirse en una **ventana emergente (modal)**.
- Cada acta debe quedar **enlazada** a la orden de producción que la originó
  (nombre + código de la orden), de forma que desde el acta se pueda
  identificar de qué orden y de qué etapa específica proviene.
  Ej: *Acta de Fundido* → Orden "Cadenas cubanas lote agosto" (`OP-2026-0001`).

---

## 6. Eliminación de recetas y ensamblaje

- El módulo de **recetas** y el de **ensamblar** ya no tienen sentido con el
  nuevo flujo dinámico por procesos y se deben **eliminar**: pantallas,
  rutas, lógica de negocio y referencias en el resto de la app (menús,
  permisos, validaciones que dependan de ellos).

**Confirmado:** se elimina todo — código, rutas, UI y también las tablas de
BD y datos históricos de recetas y ensamblaje. No se conserva nada para
consulta posterior. Incluir migración de base de datos que elimine estas
tablas/columnas y limpie cualquier referencia (foreign keys, menús,
permisos, seeds).

---

## 7. Estadísticas

- Se mantiene el resumen de mermas por etapa al finalizar cada orden
  individual (como ya existe hoy).
- Se agrega una vista nueva en el panel de estadísticas: **merma agregada
  por proceso, independiente de la orden** (ej: "Merma general en Fundido:
  X kg", "Merma general en Laminado: Y kg"), sumando esa métrica a través de
  todas las órdenes que hayan usado ese proceso.

**[REVISAR]** ¿La merma agregada por proceso debe poder filtrarse por rango
de fechas, o siempre es el acumulado histórico total? Asumo que conviene
agregar un filtro de fechas opcional, igual que en el resto del panel de
estadísticas si ya existe ese patrón.

---

## 8. Códigos / nomenclatura (propuesta)

Con el cambio a etapas y actas dinámicas, se necesita un esquema de códigos
consistente:

- **Código de orden**: `OP-{año}-{secuencial}` → ej. `OP-2026-0001`
  (el nombre textual que ingresa el usuario es independiente y se muestra
  junto al código, no lo reemplaza).
- **Código de acta**: `{código de orden}-{abreviatura del proceso}-{secuencial
  de repeticiones de ese proceso en esa orden}` → ej. `OP-2026-0001-FUND-01`.
  Si el proceso "Fundido" se repite (por un rechazo ✘), la siguiente acta de
  ese mismo proceso en esa orden sería `OP-2026-0001-FUND-02`.

**Confirmado:** se usa este esquema (`OP-{año}-{secuencial}` para la orden y
`{código de orden}-{abreviatura del proceso}-{secuencial}` para el acta de
cada etapa). Nota de implementación: como ahora un rechazo (✘) puede cambiar
de proceso, el secuencial de acta (`-01`, `-02`...) debe llevarse **por
proceso dentro de la orden**, no por etapa cronológica — es decir, si en una
orden se repite Fundido dos veces (aunque no sea consecutivo), esas actas
serían `FUND-01` y `FUND-02`.

---

## 9. Checklist de implementación sugerido

- [ ] Fix 1.1 — actualización en tiempo real de edición/eliminación en acta
- [ ] Fix 1.2 — rowspan de fechas en columna Fecha del acta
- [ ] Migración de roles: unificar Inventario + Producción
- [ ] Ajustar permisos y navegación según el rol fusionado
- [ ] Nueva funcionalidad Admin: mensaje libre → bandeja de Solicitudes
- [ ] Cambiar lógica de Solicitudes: solo mensajes del Admin, quitar
      aprobación de salidas de materia prima
- [ ] Banco de procesos en Mantenimientos (CRUD)
- [ ] Rediseño de creación de orden: nombre libre + selección dinámica de
      procesos
- [ ] Vista de etapa activa: proceso, responsable, peso al finalizar,
      aprobar/rechazar
- [ ] Flujo de asignar/crear producto terminado desde cualquier etapa
- [ ] Generación de una acta por etapa, enlazada a la orden (código)
- [ ] Reutilizar lógica de acta para Producción/Inventario, arreglando el
      bug del botón "Devolver"
- [ ] Formulario manual de acta como modal (ya no inline)
- [ ] Eliminar módulos de recetas y ensamblaje (UI + rutas + lógica activa)
- [ ] Nueva vista de estadísticas: merma agregada por proceso
- [ ] Definir y aplicar esquema de códigos de orden/acta

---

## 10. Preguntas abiertas (resumen)

**Ya confirmadas** (ver detalle en cada sección):
- ✅ Recetas/ensamblaje: se elimina todo, código y datos (sección 6).
- ✅ Rechazo de etapa: permite reasignar responsable y proceso (sección 4).
- ✅ Código de acta: `OP-{año}-{secuencial}-{PROCESO}-{secuencial}`, secuencial
  por proceso dentro de la orden (sección 8).

**Pendientes:**
1. Migración de usuarios con rol antiguo Inventario/Producción → ¿automática
   al rol fusionado?
2. Historial de mensajes Admin↔Inventario, ¿permanente o efímero?
3. Campos exactos del banco de procesos y si reutiliza la tabla de etapas.
4. ¿El rechazo de una etapa debe pedir un motivo (texto) obligatorio para
   trazabilidad?
5. ¿Flujo secuencial estricto o se permiten ramas paralelas por orden?
6. Definición exacta de "peso al finalizar" y cómo se calcula la merma.
7. Estadísticas por proceso: ¿con filtro de fechas o acumulado total?

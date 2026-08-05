# Certificados históricos: importar "Ordenes de Producción.xlsx" al sistema

Fecha: 2026-08-04

## Contexto

El cliente llevaba en papel (y luego en un Excel de respaldo,
`Joyeria/Ordenes de Producción.xlsx`) el registro de sus órdenes de
producción de plata: 37 órdenes (ID 1 a 37, en dos hojas "1-18" y "19-37"),
cada una con un bloque "Entregado" (materia prima que salió a producción) y
un bloque "Recibido" (lo que volvió), cada bloque con su propia tabla
Fecha/Gramos/Detalles. Quiere esos 37 registros dentro del sistema, viéndose
como cualquier otro certificado de "Orden de Producción" ya generado por el
sistema (mismo formato, mismo folio `OP-2026-XXXX`), no como un archivo
aparte.

## Regla de lectura del Excel (confirmada con el usuario)

En la columna Fecha de cada tabla Entregado/Recibido: una fila con fecha
abre un grupo nuevo — **cada fila con fecha**, aunque repita el mismo día
que la fila anterior (ej. dos entregas distintas logueadas el mismo 13/07);
todas las filas de abajo sin fecha pertenecen a ese mismo grupo hasta que
aparece la próxima fecha (o termina la sección). Cada grupo es un "evento"
(una entrega o una recepción real, con su propio responsable). Verificado
con el parser real contra el archivo: de 74 secciones Entregado/Recibido,
**15** tienen 2 o más eventos (varios dentro del mismo lado), y en **12**
de las 37 órdenes la cantidad de eventos de Entregado no coincide con la de
Recibido (ej. orden 8 "Máquinas": 3 entregas, 5 recepciones). Solo la orden
**29** ("Solar") no tiene ningún evento de recepción. El modelo tiene que
soportar esa asimetría.
(Nota: un conteo exploratorio previo con un script ad-hoc dio 11/15/4 —
estaba mal porque deduplicaba por fecha-calendario en vez de contar cada
fila con fecha como su propio evento; el parser real implementado en Task 6
sigue la regla tal como está escrita arriba y es la fuente de verdad.)

## Decisiones confirmadas

1. **Folio real, mismo contador que las órdenes en vivo.** Se insertan como
   filas reales de `production_runs`, folio `OP-2026-0001` .. `OP-2026-0037`
   (se confirmó que hoy no hay ninguna orden real creada todavía, así que no
   hay choque). Las órdenes que se creen después en el uso normal siguen
   desde `OP-2026-0038` sin tocar nada — `next_run_seq_this_year` ya calcula
   el siguiente número a partir del máximo `production_code` existente.
2. **Una "familia" de corridas por orden histórica**, igual que una orden en
   vivo partida por falta de material. Por cada orden del Excel se crean
   `N = max(eventos_entregado, eventos_recibido)` corridas
   (`ProductionRun`) con el mismo `root_production_code`; cada corrida
   aporta como máximo un evento de entrega y uno de recepción (algunas solo
   entrega, algunas solo recepción, según haga falta para cuadrar los
   conteos reales). Esto reutiliza tal cual el mecanismo de familia/split ya
   construido — folio agrupado, "Gestionar" por corrida, certificado
   unificado — cero UI nueva ahí.
3. **Tabla nueva `production_run_event_lines`** (aditiva, no toca nada de lo
   que ya funciona): guarda las líneas de detalle tal cual el papel, porque
   una corrida en vivo solo sabe mostrar **una** fila de cantidad por evento
   (el total de materia prima) y el papel trae varias líneas con texto
   propio por evento (ej. "162 Dolorosas", "Desp. medallas", 5 a 11 líneas
   por bloque). Columnas: `id`, `run_id` (FK), `side` (`ENTREGA`|`RECEPCION`),
   `gramos` (Numeric), `unidad` (String), `detalle` (Text), `line_order`
   (Integer). `buildOrdenProduccion` (frontend) usa estas líneas como las
   `rows` del `DocSide` cuando existen para esa corrida/lado, en vez de la
   fila única calculada de `total_required_material`. Las órdenes en vivo
   nunca llenan esta tabla — sin cambio de comportamiento para ellas.
4. **Responsable como texto libre, sin usuario nuevo.** Se agregan dos
   columnas nullable a `production_runs`:
   `materials_approved_responsable_name` y `received_responsable_name`
   (String). El backend, al armar `ProductionRunRead`, usa el nombre
   resuelto por `user_id` si existe (comportamiento actual, sin cambios para
   órdenes en vivo) y si no, cae a estos campos de texto. Así "Santy",
   "Rocío", "Juan Carlos", etc. se ven en el certificado sin crear cuentas
   de login para gente que no las tiene ni las va a tener.
5. **Proceso genérico único para lo histórico**: se crea un
   `ProductionProcess` de datos (no código) llamado
   "Producción histórica migrada" con 2 etapas simples (Entregado /
   Recibido), igual que cualquier proceso configurado desde el
   administrador — respeta el principio de constructor genérico, nada
   quemado en código.
6. **Materia prima**: NO se vincula a ninguna materia prima real del
   inventario (el real tiene 3 variantes — PLATA MIL, PLATA LIGADA, PLATA
   VARIOS — y el usuario pidió explícitamente no atar lo histórico a
   ninguna de ellas). Se crea un `InventoryItem` dedicado, "Plata
   (histórico)", `is_active=False` y `archived_at` seteado (invisible en el
   inventario normal, `current_stock=0` para siempre, nunca recibe
   movimientos) y se usa su id como `raw_material_item_id`. El script
   soporta `--raw-material-name` (match exacto, case-insensitive) para
   apuntar a este item dedicado en vez de adivinar por substring.
7. **Campo "Cantidad" del certificado**: se oculta para las corridas
   históricas (no existe ese dato en el papel — es un libro de gramos, no
   de piezas fabricadas). `quantity` interno se guarda en 1 solo para
   satisfacer la columna NOT NULL; no se muestra en pantalla. Regla exacta
   en `buildOrdenProduccion`: si **algún** miembro de la familia tiene
   líneas en `production_run_event_lines`, la familia se trata como
   histórica completa (no se mezclan órdenes en vivo con históricas en una
   misma familia, nunca pasa en la práctica) y `OrdenProduccionModel.cantidad`
   se arma como `null` en vez de un número; `orden-produccion-doc.tsx` no
   pinta la línea "Cantidad: N" cuando es `null`. Las órdenes en vivo siguen
   mostrando su cantidad real, sin cambio.
8. **Estado de cada corrida**: `RECIBIDA` si tiene evento de recepción,
   `PENDIENTE_RECEPCION` si solo tiene entrega (4 órdenes del Excel — 29, 31,
   35, 36 — nunca muestran recepción; se refleja tal cual, no se inventa un
   cierre que no está en el papel).
9. **Sin movimientos de inventario ni impacto en stock actual.** El script
   inserta directo con SQLAlchemy (los modelos, no el service layer de
   aprobar/recibir), así nunca llama a `consume_material_for_production` ni
   toca `current_stock` — son datos de archivo, el stock físico actual ya
   está contado aparte.
10. **`created_by_user_id` de cada corrida**: no hay un "usuario histórico"
    razonable — el script pide como parámetro obligatorio el id (o
    username) de una cuenta real ya existente en el sistema (ej. la cuenta
    admin del propio Rodrigo) y la usa para las 37 órdenes; no crea ningún
    usuario nuevo para esto. `assembly_mode` queda en `ASIGNAR` (no hay
    ensamble ni complementos en el Excel) y `waste_limit_percent` de cada
    corrida copia el del proceso genérico histórico.
11. **Import único, no un botón de "subir Excel".** Se corre una sola vez
    como script de migración de datos (con salida en modo *dry-run* primero:
    imprime a qué material mapeó, cuántas corridas por orden, rango de
    folios, para que el usuario confirme antes de escribir en la base). No
    queda ninguna UI de importación en el sistema.
12. **Dónde aparecen**: mezcladas en la lista de Documentos ya existente
    (son `production_runs` reales, aparecen solas). Para que no la saturen,
    se le agrega a `documentos-dashboard.tsx` un buscador de texto (folio /
    proceso / responsable) y un filtro rápido "Todas / En vivo / Históricas"
    (una corrida es histórica si su familia tiene al menos una línea en
    `production_run_event_lines`), más agrupación visual por mes en la
    lista — mismo patrón de historial con fecha que ya usan otros módulos
    del sistema (inventario), sin construir un calendario nuevo desde cero.

## Addendum (post-implementación, revisión final de rama)

13 de las 58 corridas a crear quedan `PENDIENTE_RECEPCION` (entregaron más
veces de las que recibieron — el papel nunca registró esa recepción, ej.
orden 11 "Rosario 60cm": 6 entregas, 1 recepción). La revisión final
encontró que, tal como estaba el plan, esas 13 corridas caían en las colas
EN VIVO de Inventario (`pendingReceptionRuns`, badge de solicitudes) — un
click en "Recibir" ahí dispara `receive_finished_product`, que sí genera un
movimiento de inventario real. Eso viola la decisión #9 (nunca tocar stock).
Fix aplicado: el estado se mantiene tal cual (refleja la realidad del
papel, no se inventa un cierre), pero (a) el backend rechaza
`receive_finished_product` sobre cualquier corrida con `event_lines` no
vacío, y (b) el frontend excluye las corridas con `event_lines` de las
colas de pendientes en vivo. `canPrintRecepcion`/`canPrintEntrega` se
vuelven "algún miembro cumple" en vez de "todos" cuando la familia es
histórica, para no bloquear la impresión de lo que sí está en el papel solo
porque falta una recepción que nunca existió.

## Fuera de alcance

- No se valida ni se corrige el contenido del Excel (errores de tipeo del
  papel original, como el "5.4" que aparece en una columna Fecha de la
  fila 389, se guardan tal cual quedan al parsear — si no es una fecha
  real, ese evento simplemente no tiene fecha, como una fila más del grupo
  anterior).
- No se construye un importador reusable de Excel: el parser vive en el
  script de migración, ligado al layout exacto de este archivo.
- Insumos y complementos: el Excel no los menciona, ninguna corrida
  histórica los lleva.
- Verificación visual del PDF impreso de las históricas: el usuario la hace
  en papel/preview, igual que se dejó pendiente para el certificado
  unificado.

## Plan de verificación manual

1. Correr el script en modo dry-run, revisar el resumen (37 órdenes, folio
   OP-2026-0001..0037, material mapeado, corridas por orden) antes de
   confirmar la escritura real.
2. Tras importar: abrir Documentos, buscar por folio y por nombre de
   responsable (ej. "Santy"), confirmar que aparecen y filtran bien.
3. Abrir un caso simple (una sola entrega, una sola recepción, ej. orden
   16 "Fundir 1 Barra") y confirmar que el certificado se ve limpio, sin
   fila de "Responsable" de más (un solo evento por lado).
4. Abrir un caso con eventos asimétricos (ej. orden 8 "Máquinas", 3
   entregas / 5 recepciones) y confirmar que cada evento muestra su fecha,
   su responsable y sus líneas de detalle propias, y que el conteo de
   corridas de la familia coincide.
5. Confirmar que crear una orden nueva en vivo después del import le cae
   el folio `OP-2026-0038` sin colisión.
6. Confirmar en Kardex/inventario que el stock actual de Plata no cambió
   por el import.

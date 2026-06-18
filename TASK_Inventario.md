# TASK Inventario

## Registro de cambios

### 2026-06-17 - Preparacion de instrucciones Docker

Que se hizo:
- Se actualizo `PROMPT_AGENTE_INVENTARIO.md` para que el agente de inventario mantenga Docker actualizado cuando agregue dependencias, variables, puertos, servicios o comandos.
- Se dejo explicito que inventario puede tocar `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `requirements.txt` y `README.md` solo cuando su cambio lo requiera.
- Se agrego la obligacion de registrar en este TASK si Docker cambio o si no requirio cambios.

Que falta:
- Cuando se implemente inventario, actualizar este TASK con los cambios reales del modulo.
- Si inventario agrega dependencias o servicios, actualizar Docker y ejecutar `docker-compose config`.

Archivos modificados:
- `PROMPT_AGENTE_INVENTARIO.md`
- `TASK_Inventario.md`

Puntos para integrar luego con produccion:
- Inventario debera implementar el contrato `InventoryIntegrationPort` definido en `backend/modules/shared/contracts/inventory.py`.
- Inventario debera mantener Docker compatible para que produccion pueda probar la integracion.

Docker:
- Sin cambios tecnicos requeridos para inventario en esta sesion; solo se actualizaron instrucciones.

Verificaciones ejecutadas:
- `git status -sb`
- `git diff --name-only`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto `docker-compose config` por este cambio de inventario porque no se modificaron archivos Docker.

### 2026-06-17 - Skill global de frontend

Que se hizo:
- Se actualizo `PROMPT_AGENTE_INVENTARIO.md` para exigir leer `SKILL.md` antes de cualquier cambio frontend.
- Se dejo indicado que inventario debe compartir diseno, lenguaje visual, tablas, filtros, badges, formularios y componentes con produccion.
- Se dejo indicado que los componentes reutilizables deben vivir en rutas compartidas cuando sirvan a mas de un modulo.

Que falta:
- Cuando se implemente frontend de inventario, aplicar `SKILL.md` completo.
- Reutilizar componentes compartidos creados por produccion cuando correspondan.
- Crear componentes compartidos nuevos solo si tambien pueden servir a otros modulos.

Archivos modificados:
- `SKILL.md`
- `PROMPT_AGENTE_INVENTARIO.md`
- `PROMPT_AGENTE_PRODUCCION.md`
- `PROMPT_AGENTE_GENERICO.md`
- `TASK_Inventario.md`
- `TASK_Produccion.md`

Puntos para integrar luego con produccion:
- Inventario debe compartir patrones de interfaz con produccion.
- Inventario debe exponer disponibilidad, reservas y movimientos relacionados con produccion sin mezclar logica de dominio.

Docker:
- Sin cambios requeridos por esta actualizacion; solo se modificaron instrucciones y el skill global.

Reglas de `SKILL.md` aplicadas:
- Se establecio que inventario y produccion funcionen como flujos hermanos dentro del mismo ERP.
- Se priorizaron componentes compartidos para estados, tablas, filtros, layout y feedback.

Verificaciones ejecutadas:
- `git status -sb`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto `docker-compose config` porque no se modificaron archivos Docker.

### 2026-06-18 - Acciones por tipo de inventario

Que se hizo:
- Se ajustaron las acciones visibles segun el menu de inventario seleccionado.
- En `Materia prima` se muestran solo `Entrada` y `Materia prima`.
- En `Producto terminado` se muestra solo `Salida`.
- En `Producto en proceso` no se muestran acciones manuales de entrada, salida ni creacion de materia prima.
- El formulario de salida ahora lista productos terminados, no materia prima.
- El menu de `Entrada` se cierra al cambiar de seccion.

Que falta:
- Implementar mas adelante la salida/consumo de materia prima desde el flujo de produccion, sin hacerlo desde esta pantalla.
- Definir luego el flujo operativo de productos en proceso cuando se construya la ventana correspondiente.

Archivos modificados:
- `frontend/components/inventory/inventory-dashboard.tsx`
- `TASK_Inventario.md`

Puntos para integrar luego con produccion:
- La salida de materia prima debe nacer del inicio o avance de un proceso de produccion en una ventana futura.
- `Producto en proceso` queda sin acciones manuales porque debe alimentarse desde el flujo productivo y contratos compartidos.
- Las salidas manuales actuales quedan acotadas a productos terminados.

Docker:
- Sin cambios requeridos; no se agregaron dependencias, variables, puertos ni comandos.

Reglas de `SKILL.md` aplicadas:
- Se mantuvieron acciones contextuales y compactas para reducir ruido visual.
- Se evito exponer acciones que pertenecen a otro flujo operativo.

Verificaciones ejecutadas:
- `npm.cmd run build` en `frontend`.

Verificaciones no ejecutadas o no completadas:
- No se ejecuto `docker-compose config` porque no se modificaron archivos Docker.

### 2026-06-18 - Cierre de menu de entrada

Que se hizo:
- El menu desplegable de `Entrada` ahora se cierra al hacer clic fuera del menu.
- Se mantuvo activo el clic interno para seleccionar `Manual` o `Factura XML` sin cerrar antes de ejecutar la accion.

Que falta:
- Sin pendientes para este ajuste puntual.

Archivos modificados:
- `frontend/components/inventory/inventory-dashboard.tsx`
- `TASK_Inventario.md`

Puntos para integrar luego con produccion:
- Sin cambios nuevos de integracion; se mantiene como comportamiento de UI de inventario.

Docker:
- Sin cambios requeridos; no se agregaron dependencias, variables, puertos ni comandos.

Reglas de `SKILL.md` aplicadas:
- Se mantuvo un control compacto y predecible para acciones de inventario.
- No se crearon componentes compartidos porque el comportamiento es especifico del menu de entrada de inventario.

Verificaciones ejecutadas:
- `npm.cmd run build` en `frontend`.

Verificaciones no ejecutadas o no completadas:
- No se ejecuto `docker-compose config` porque no se modificaron archivos Docker.

### 2026-06-18 - Acciones de entrada y salida en inventario

Que se hizo:
- Se redujo la saturacion de acciones en el panel de inventario actual.
- Se reemplazo el boton separado de `Factura XML` por un menu desplegable bajo `Entrada`.
- El boton `Entrada` ahora despliega dos opciones: `Manual` y `Factura XML`.
- El boton `Salida` ahora usa icono de menos en lugar de icono de mas.
- El modal de movimiento ahora muestra `Registrar salida` cuando el movimiento es de salida.

Que falta:
- Evaluar cerrar el menu de entrada al hacer clic fuera si el flujo lo requiere.
- Mantener la integracion de factura XML limitada a inventario y sin mezclar logica de produccion.

Archivos modificados:
- `frontend/components/inventory/inventory-dashboard.tsx`
- `frontend/app/globals.css`

Puntos para integrar luego con produccion:
- La importacion por factura XML registra entradas de inventario; produccion debera consumir disponibilidad y movimientos mediante contratos compartidos, no desde esta UI.
- Las salidas manuales siguen siendo movimientos de inventario; consumo de produccion debe integrarse despues desde el contrato del backend.

Docker:
- Sin cambios requeridos; no se agregaron dependencias, variables, puertos ni comandos.

Reglas de `SKILL.md` aplicadas:
- Se uso un menu compacto para opciones de entrada y se redujo la cantidad de botones visibles.
- Se mantuvo el estilo operacional SaaS, con controles compactos y consistentes.

Verificaciones ejecutadas:
- `npm.cmd run build` en `frontend`.
- Revision de diff de `frontend/components/inventory/inventory-dashboard.tsx` y `frontend/app/globals.css`.

Verificaciones no ejecutadas o no completadas:
- No se ejecuto `docker-compose config` porque no se modificaron archivos Docker.

### 2026-06-17 - Mantenimiento y visualizacion inicial de inventario

Que se hizo:
- Se implemento el modulo backend de inventario con items y movimientos.
- Se cubrieron los tres casos de inventario:
  - Materia prima.
  - Producto en proceso.
  - Producto terminado.
- Se agrego mantenimiento de items de inventario:
  - Crear item.
  - Editar item.
  - Desactivar item.
  - Visualizar detalle.
- Se agrego registro de movimientos de inventario.
- El stock actual no se edita manualmente desde mantenimiento; cambia al registrar movimientos.
- Se implementaron tipos de movimiento:
  - `ENTRADA`
  - `SALIDA`
  - `AJUSTE_POSITIVO`
  - `AJUSTE_NEGATIVO`
  - `CONSUMO_PRODUCCION`
  - `INGRESO_PRODUCCION`
  - `MERMA`
- Se bloqueo que un movimiento deje stock negativo.
- Se agrego resumen de inventario por tipo y stock bajo.
- Se conecto el router `/api/inventory`.
- Se agregaron permisos de inventario para `Admin`, `admin` dev y `Jefe de inventario`.
- Se implemento parcialmente `InventoryIntegrationPort` desde `InventoryService`:
  - `check_material_availability`
  - `reserve_materials_for_production`
  - `commit_finished_production`
- Se creo frontend `/inventario`.
- Se agrego pantalla funcional de inventario con:
  - tarjetas de los tres casos
  - filtro por caso
  - busqueda por nombre o SKU
  - lista de inventario con scroll
  - lista de movimientos con scroll
  - formularios modales para item y movimiento
  - vista detalle de item
- Se agrego titulo dinamico del `AppShell` para `/inventario`.

Que falta:
- Validar backend dentro del contenedor cuando Docker este levantado.
- Crear migraciones formales cuando se estabilice el esquema; por ahora el proyecto usa `AUTO_CREATE_TABLES`.
- Agregar filtros avanzados de movimientos por fecha/tipo cuando el flujo operativo crezca.
- Implementar reservas reales si produccion lo requiere; ahora la reserva valida disponibilidad sin crear una tabla de reservas.
- Conectar produccion con inventario cuando se desarrolle la pantalla del jefe de produccion.

Archivos modificados:
- `backend/app/main.py`
- `backend/modules/auth/dependencies.py`
- `backend/modules/auth/service.py`
- `backend/modules/inventory/models.py`
- `backend/modules/inventory/repository.py`
- `backend/modules/inventory/router.py`
- `backend/modules/inventory/schemas.py`
- `backend/modules/inventory/service.py`
- `frontend/app/globals.css`
- `frontend/app/inventario/page.tsx`
- `frontend/components/inventory/inventory-dashboard.tsx`
- `frontend/components/layout/app-shell.tsx`
- `frontend/lib/inventory-api.ts`
- `frontend/types/inventory/index.ts`
- `TASK_Inventario.md`

Puntos para integrar luego con produccion:
- Produccion debe consultar disponibilidad mediante `InventoryIntegrationPort.check_material_availability`.
- Produccion debe solicitar reservas mediante `InventoryIntegrationPort.reserve_materials_for_production` cuando se formalice el flujo de orden.
- Produccion debe notificar producto terminado mediante `InventoryIntegrationPort.commit_finished_production`.
- Los movimientos `CONSUMO_PRODUCCION`, `INGRESO_PRODUCCION` y `MERMA` quedan preparados para trazabilidad con referencias de produccion.
- Inventario no implementa procesos ni etapas de produccion; solo registra stock y movimientos.

Docker:
- Sin cambios requeridos.
- No se agregaron dependencias, servicios, variables, puertos ni comandos.
- No se ejecuto `docker-compose config` porque no se modificaron archivos Docker.

Reglas de `SKILL.md` aplicadas:
- Pantalla operacional dentro del shell ERP existente.
- Diseño consistente con produccion: tarjetas, toolbar, filtros, listas, modales, botones con iconos y feedback temporal.
- Sin landing page ni datos falsos.
- Scroll interno para listas de inventario y movimientos.
- Controles familiares: selects para opciones, inputs para cantidades, botones con iconos para acciones.

Verificaciones ejecutadas:
- `rg` confirmo endpoints, tipos y componentes de inventario.
- `npm.cmd run build` paso correctamente e incluyo la ruta `/inventario`.
- `docker-compose ps` confirmo que no habia contenedores levantados.
- `git status -sb`
- `git diff --name-only`

Verificaciones no ejecutadas o no completadas:
- `python -m compileall ...` no pudo ejecutarse porque `python` no esta instalado localmente.
- `py -3 -m compileall ...` no pudo ejecutarse porque no hay Python instalado localmente.
- No se compilo backend dentro de Docker porque no habia contenedores levantados y no se reinicio/creo uno nuevo en esta sesion.

### 2026-06-17 - Reubicacion de alertas flotantes

Que se hizo:
- Se movio `toastStack` de la esquina superior derecha a la esquina inferior derecha.
- El cambio evita que las alertas temporales tapen botones superiores de las ventanas, como la `X` de cierre.
- El ajuste aplica a inventario y a otras pantallas que usen el mismo estilo compartido.

Que falta:
- Validar visualmente en navegador luego de la recarga manual del frontend.

Archivos modificados:
- `frontend/app/globals.css`
- `TASK_Inventario.md`

Puntos para integrar luego con produccion:
- Produccion tambien se beneficia porque usa `toastStack`; no se modifico logica de produccion.

Docker:
- Sin cambios requeridos.

Reglas de `SKILL.md` aplicadas:
- Se mantuvo feedback visible sin bloquear acciones principales de modales.
- Se ajusto una pieza compartida de UI para mantener consistencia entre modulos.

Verificaciones ejecutadas:
- `rg` confirmo que `toastStack` ahora usa `bottom: 24px` y ya no `top: 78px`.
- `npm.cmd run build` paso correctamente.

Verificaciones no ejecutadas o no completadas:
- No se reinicio Docker porque no fue solicitado.

### 2026-06-17 - Restriccion de ingresos manuales y SKU automatico

Que se hizo:
- Se corrigio el error `Extra inputs are not permitted` al crear items de inventario.
- Se elimino el campo `SKU` del formulario y del payload de creacion/edicion.
- El SKU ahora se genera automaticamente en backend con formato simple por caso:
  - `MP-0001` para materia prima.
  - `PP-0001` para producto en proceso.
  - `PT-0001` para producto terminado.
- Se restringio la creacion manual de items a `Materia prima`.
- `Producto en proceso` y `Producto terminado` quedan como casos visibles, pero no editables/cargables manualmente desde la UI.
- Se ocultaron acciones de editar/desactivar para items que no sean materia prima.
- El registro manual de movimiento ahora queda limitado a ingresos `ENTRADA`.
- Se quito el selector de tipo de movimiento del formulario manual y se renombro la accion a `Ingreso`.
- Se agrego importacion de facturas XML desde frontend:
  - Lee nodos `detalle`.
  - Usa `descripcion` y `cantidad`.
  - Crea materia prima automaticamente si no existe por nombre.
  - Registra entradas de inventario por cada linea valida.
- El backend rechaza movimientos manuales distintos de `ENTRADA` desde `/api/inventory/movements`.

Que falta:
- Validar con XML real de factura del proveedor para ajustar nombres exactos de nodos si algun formato difiere.
- Cuando se construya el modulo del jefe de produccion, crear/actualizar producto en proceso y terminado desde ese flujo, no manualmente.
- Definir si el importador XML debe guardar el archivo original como documento de inventario.

Archivos modificados:
- `backend/modules/inventory/router.py`
- `backend/modules/inventory/schemas.py`
- `backend/modules/inventory/service.py`
- `frontend/components/inventory/inventory-dashboard.tsx`
- `frontend/lib/inventory-api.ts`
- `TASK_Inventario.md`

Puntos para integrar luego con produccion:
- Producto en proceso y producto terminado deben generarse/ingresar desde el modulo de jefe de produccion.
- Inventario queda preparado para recibir `INGRESO_PRODUCCION` mediante el servicio interno, no desde carga manual.
- Produccion debera decidir cuando crear referencias de producto terminado y cuando notificar movimientos.

Docker:
- Sin cambios requeridos.
- No se agregaron dependencias ni servicios.

Reglas de `SKILL.md` aplicadas:
- Se mantuvo la pantalla funcional y orientada a operacion.
- Se evito pedir datos que el sistema puede generar automaticamente.
- Se mantuvieron controles familiares: archivo XML, inputs y botones claros.

Verificaciones ejecutadas:
- `rg` confirmo que el formulario ya no usa `SKU` manual y que XML/importacion estan presentes.
- `npm.cmd run build` fallo inicialmente por cache generada corrupta en `.next/dev/types`.
- Se limpio `frontend/.next` como cache generada de Next.
- `npm.cmd run build` paso correctamente despues de limpiar la cache.

Verificaciones no ejecutadas o no completadas:
- No se validaron endpoints backend localmente porque no hay Python instalado y no habia contenedores Docker levantados.
- No se probo con factura XML real porque no se proporciono un archivo de ejemplo.

### 2026-06-17 - Unidad por combo y simplificacion de ingresos

Que se hizo:
- Se cambio el campo `Unidad` de texto libre a combo box.
- Se agregaron unidades comunes para oro, plata y goldfield:
  - Gramos (`g`)
  - Kilogramos (`kg`)
  - Miligramos (`mg`)
  - Onza troy (`oz_t`)
  - Pennyweight (`dwt`)
  - Quilates/carats (`ct`)
  - Unidad (`und`)
- Se quito `Stock minimo` del formulario y de la vista previa.
- Se quito `Costo unitario opcional` del formulario de ingreso.
- La importacion XML ya no usa `precioUnitario`; registra cantidad y motivo del ingreso.
- Se mantiene internamente soporte opcional de costo/stock minimo en backend para compatibilidad futura, pero no se expone al usuario en este flujo.

Que falta:
- Validar visualmente en navegador luego de la recarga manual del frontend.
- Confirmar si luego se agregaran unidades adicionales segun proveedores reales.

Archivos modificados:
- `frontend/components/inventory/inventory-dashboard.tsx`
- `frontend/lib/inventory-api.ts`
- `TASK_Inventario.md`

Puntos para integrar luego con produccion:
- Produccion debera enviar cantidades con `unit_code` compatible con estas unidades o con las que se definan despues.
- Producto en proceso y terminado siguen sin mantenimiento manual; vendran del flujo del jefe de produccion.

Docker:
- Sin cambios requeridos.

Reglas de `SKILL.md` aplicadas:
- Se uso combo para un conjunto cerrado de opciones.
- Se redujeron campos no necesarios del formulario para mejorar ergonomia.

Verificaciones ejecutadas:
- `rg` confirmo que `Stock minimo` y `Costo unitario` ya no aparecen en la pantalla.
- `npm.cmd run build` paso correctamente.

Verificaciones no ejecutadas o no completadas:
- No se reinicio Docker porque no fue solicitado.

### 2026-06-17 - Trazabilidad de usuarios en movimientos

Que se hizo:
- Se conecto la pantalla de inventario con el usuario autenticado actual.
- Se aprovecho el campo `created_by` que ya guarda el backend al registrar movimientos de inventario.
- La cuenta admin ahora carga la lista de usuarios y ve en el historial de movimientos quien registro cada movimiento.
- Para movimientos internos sin usuario, como futuros ingresos desde integraciones, se muestra `Sistema`.
- Para usuarios no admin, la trazabilidad no se muestra en la interfaz.

Que falta:
- Validar visualmente en navegador con una cuenta admin y una cuenta no admin.
- Si mas adelante se requiere ocultamiento estricto desde API, crear un endpoint o serializador admin-only para auditoria de inventario.

Archivos modificados:
- `frontend/components/inventory/inventory-dashboard.tsx`
- `TASK_Inventario.md`

Puntos para integrar luego con produccion:
- Los movimientos generados por produccion podran quedar como `Sistema` o recibir el usuario del jefe de produccion cuando se conecte ese flujo.
- La auditoria admin debe mantenerse al integrar movimientos `CONSUMO_PRODUCCION`, `INGRESO_PRODUCCION` y `MERMA`.

Docker:
- Sin cambios requeridos.

Reglas de `SKILL.md` aplicadas:
- Se mantuvo la trazabilidad como dato operativo dentro del historial, sin sobrecargar la vista de usuarios no admin.

Verificaciones ejecutadas:
- `npm.cmd run build` paso correctamente e incluyo la ruta `/inventario`.

Verificaciones no ejecutadas o no completadas:
- Pendiente validar en navegador porque no se solicito reiniciar Docker ni abrir servidor.

### 2026-06-17 - Historial completo de movimientos en modal

Que se hizo:
- La tarjeta principal de movimientos ahora muestra solo los movimientos mas recientes para evitar saturar la pantalla.
- Se agrego un boton con ojo para abrir el historial completo de movimientos.
- El historial completo queda accesible en una ventana modal con scroll interno.
- Los movimientos del modal se ordenan del mas reciente al mas antiguo.
- El historial se agrupa por fecha para que no quede todo amontonado en una sola lista.
- Se agrego hora visible en cada movimiento.
- Se mantiene la auditoria de usuario visible solo para admin dentro de la tarjeta y del modal.

Que falta:
- Validar visualmente el modal con muchos movimientos reales.
- Agregar filtros por rango de fecha o item si el historial crece demasiado.

Archivos modificados:
- `frontend/components/inventory/inventory-dashboard.tsx`
- `frontend/app/globals.css`
- `TASK_Inventario.md`

Puntos para integrar luego con produccion:
- Los movimientos creados desde produccion tambien apareceran en este historial persistente.
- Al integrar produccion, conviene enviar referencias (`reference_type`/`reference_id`) para poder filtrar movimientos por proceso u orden.

Docker:
- Sin cambios requeridos.

Reglas de `SKILL.md` aplicadas:
- Se mantuvo una vista operacional compacta con acceso progresivo al detalle completo.
- Se uso un boton con icono para visualizar el historial completo.
- El historial largo usa scroll interno dentro de modal.

Verificaciones ejecutadas:
- `npm.cmd run build` paso correctamente e incluyo la ruta `/inventario`.

Verificaciones no ejecutadas o no completadas:
- Pendiente validar en navegador porque no se solicito reiniciar Docker ni abrir servidor.

### 2026-06-17 - Calendario visual para historial de inventario

Que se hizo:
- La lista principal de movimientos ahora muestra unicamente movimientos de los ultimos 30 dias.
- Se reemplazo la lista larga del historial por un calendario visual mensual.
- El calendario marca los dias que tienen movimientos y muestra la cantidad de movimientos por dia.
- Se agrego navegacion de mes anterior y mes siguiente.
- Al seleccionar una fecha, se listan solo los movimientos de ese dia.
- La lista diaria mantiene la trazabilidad de usuario visible solo para admin.
- Se elimino el comportamiento de revisar todo el historial como un scroll largo continuo.

Que falta:
- Validar visualmente con movimientos distribuidos en varios meses reales.
- Mas adelante se puede agregar busqueda por item o tipo dentro del dia seleccionado si la operacion lo requiere.

Archivos modificados:
- `frontend/components/inventory/inventory-dashboard.tsx`
- `frontend/app/globals.css`
- `TASK_Inventario.md`

Puntos para integrar luego con produccion:
- Los movimientos que genere produccion apareceran en el calendario segun su fecha.
- Cuando produccion envie referencias, el detalle diario podra mostrar o filtrar por proceso/orden.

Docker:
- Sin cambios requeridos.

Reglas de `SKILL.md` aplicadas:
- Se evito un historial infinito y se uso una navegacion visual clara por fecha.
- La tarjeta principal mantiene una lectura operacional del ultimo mes.
- El detalle largo queda bajo demanda en modal con calendario.

Verificaciones ejecutadas:
- `npm.cmd run build` paso correctamente e incluyo la ruta `/inventario`.

Verificaciones no ejecutadas o no completadas:
- No se reinicio Docker ni se valido en navegador porque no fue solicitado.

### 2026-06-17 - Dashboard general con informacion de inventario

Que se hizo:
- Se quito el texto `Ver historial por calendario` de la tarjeta de movimientos; el acceso queda solo con el boton de ojo.
- Se conecto el dashboard general con datos reales de inventario.
- El dashboard ahora carga:
  - resumen de inventario
  - items de inventario
  - movimientos de inventario
- Se agrego una metrica superior de `Items de inventario`.
- Se agrego grafico de `Inventario por tipo` con materia prima, producto en proceso y producto terminado.
- Se agrego una tarjeta de movimientos recientes de inventario.
- No se agregaron datos falsos.

Que falta:
- Validar visualmente el dashboard con datos reales variados.
- Ajustar orden/prioridad de tarjetas si el admin prefiere otro enfoque operacional.

Archivos modificados:
- `frontend/components/inventory/inventory-dashboard.tsx`
- `frontend/components/dashboard/system-dashboard.tsx`
- `frontend/app/globals.css`
- `TASK_Inventario.md`

Puntos para integrar luego con produccion:
- Cuando produccion genere movimientos, el dashboard mostrara esos movimientos recientes en la tarjeta de inventario.
- El grafico de inventario por tipo reflejara productos en proceso y terminados cuando los cree el flujo del jefe de produccion.

Docker:
- Sin cambios requeridos.

Reglas de `SKILL.md` aplicadas:
- Se mantuvo el dashboard como vista operacional del sistema.
- Se usaron metricas, barras y listas compactas en lugar de textos largos.
- Se evito duplicar controles innecesarios; el historial se abre desde el icono de ojo.

Verificaciones ejecutadas:
- `npm.cmd run build` paso correctamente e incluyo la ruta `/dashboard` e `/inventario`.

Verificaciones no ejecutadas o no completadas:
- Pendiente validar en navegador porque no se solicito reiniciar Docker ni abrir servidor.

### 2026-06-17 - Compatibilidad con XML autorizado del SRI

Que se hizo:
- Se reviso un XML real de factura autorizada del SRI.
- Se ajusto el importador XML de inventario para soportar archivos con estructura:
  - `autorizacion`
  - `comprobante` en `CDATA`
  - `factura`
  - `detalles/detalle`
- El importador tambien sigue soportando XML donde la factura venga directa, sin envoltorio de autorizacion.
- Se extraen los detalles reales:
  - `codigoPrincipal`
  - `descripcion`
  - `cantidad`
- Se extrae informacion de factura para trazabilidad:
  - proveedor desde `razonSocial`
  - clave de acceso desde `claveAcceso`
  - numero de factura con `estab-ptoEmi-secuencial`
- Al crear una materia prima desde XML se guarda descripcion con codigo de factura y proveedor cuando existen.
- El movimiento de ingreso queda con motivo basado en el numero de factura o clave de acceso.

Que falta:
- Validar en navegador cargando el XML real desde la pantalla de inventario.
- Definir si productos de facturas que no sean materia prima deben excluirse o clasificarse manualmente antes de ingresar.
- Definir si se debe guardar el XML original como documento adjunto.

Archivos modificados:
- `frontend/components/inventory/inventory-dashboard.tsx`
- `TASK_Inventario.md`

Puntos para integrar luego con produccion:
- Las materias primas importadas por factura quedaran disponibles para consumo posterior desde produccion.
- Si produccion necesita trazabilidad por proveedor/factura, conviene formalizar tablas de documentos de compra en inventario.

Docker:
- Sin cambios requeridos.

Reglas de `SKILL.md` aplicadas:
- Se mantuvo la importacion dentro del flujo operacional existente, sin pedir datos manuales adicionales.
- Se uso parsing estructurado del XML en lugar de manipular cadenas de forma manual.

Verificaciones ejecutadas:
- `npm.cmd run build` paso correctamente e incluyo la ruta `/inventario`.

Verificaciones no ejecutadas o no completadas:
- Pendiente validar carga real en navegador porque no se solicito reiniciar Docker ni abrir servidor.

### 2026-06-17 - Archivo XML descargable y simplificacion de inventario

Que se hizo:
- Se quito el concepto activo/inactivo del inventario en la interfaz.
- Se quitaron las acciones de desactivar items de inventario desde la pantalla.
- Se retiro `is_active` de los contratos publicos y del modelo nuevo de items de inventario.
- Los items creados desde factura XML solo permiten editar el nombre en el formulario.
- Al importar una factura XML, el movimiento guarda:
  - nombre del archivo XML
  - tipo MIME
  - contenido original del XML
- Se agrego endpoint para descargar el XML asociado a un movimiento:
  - `GET /api/inventory/movements/{movement_id}/source-file`
- Se agrego boton `XML` en movimientos con archivo asociado para descargar la factura original.
- Se agrego actualizacion automatica de columnas de movimientos en arranque con `AUTO_CREATE_TABLES`, para que Docker agregue los campos nuevos sin pasos manuales.
- El importador intenta leer `unidadMedida` si una factura futura la trae.
- Si la unidad detectada no existe en el combo base, el frontend la agrega dinamicamente como unidad detectada para poder mostrarla sin perderla.

Que falta:
- Validar en navegador importando el XML real y descargandolo desde el movimiento.
- Validar backend dentro de Docker para confirmar que las columnas nuevas se agregan en la base existente.
- Definir si a futuro conviene una tabla formal de documentos/facturas en lugar de guardar el XML por movimiento.

Archivos modificados:
- `backend/app/main.py`
- `backend/modules/inventory/models.py`
- `backend/modules/inventory/repository.py`
- `backend/modules/inventory/router.py`
- `backend/modules/inventory/schemas.py`
- `backend/modules/inventory/service.py`
- `frontend/components/inventory/inventory-dashboard.tsx`
- `frontend/lib/api.ts`
- `frontend/lib/inventory-api.ts`
- `frontend/types/inventory/index.ts`
- `TASK_Inventario.md`

Puntos para integrar luego con produccion:
- Produccion no debe editar estos ingresos de factura; solo consumir stock mediante movimientos propios.
- Si produccion necesita trazabilidad completa, debe usar referencias de movimientos y eventualmente documentos de inventario.

Docker:
- No se modificaron archivos Docker.
- El backend incluye `ALTER TABLE IF NOT EXISTS` para actualizar la tabla `inventory_movements` al levantar Docker con `AUTO_CREATE_TABLES`.

Reglas de `SKILL.md` aplicadas:
- Se redujo el mantenimiento de inventario a datos operativos necesarios.
- Se evita exponer estados activo/inactivo que no aplican al stock.
- La descarga del XML queda como accion contextual dentro del historial de movimientos.

Verificaciones ejecutadas:
- `npm.cmd run build` paso correctamente e incluyo la ruta `/inventario`.

Verificaciones no ejecutadas o no completadas:
- No se valido backend con Python local porque Python no esta instalado en la maquina.
- No se valido en Docker ni se reinicio el contenedor porque no fue solicitado.

### 2026-06-17 - Dashboard simetrico y compacto

Que se hizo:
- Se reorganizo el dashboard general para reducir scroll vertical.
- Las metricas superiores ahora usan una composicion horizontal compacta.
- Los graficos principales quedan en tres columnas simetricas en desktop.
- El detalle inferior queda en una grilla 2x2 simetrica.
- Se limitaron las listas del dashboard a los primeros 4 registros visibles por tarjeta.
- Se definieron alturas controladas para graficos y paneles del dashboard.
- Se mantuvo la informacion real de produccion, usuarios e inventario.

Que falta:
- Validar visualmente en navegador con datos reales en desktop y mobile.
- Ajustar densidad si el usuario prefiere ver mas o menos filas por tarjeta.

Archivos modificados:
- `frontend/components/dashboard/system-dashboard.tsx`
- `frontend/app/globals.css`
- `TASK_Inventario.md`

Puntos para integrar luego con produccion:
- Cuando produccion tenga mas datos operativos, el dashboard podra sumar tarjetas sin romper la estructura compacta.

Docker:
- Sin cambios requeridos.

Reglas de `SKILL.md` aplicadas:
- Se priorizo una vista ERP compacta, escaneable y simetrica.
- Se evitaron paneles largos que empujen la pagina hacia abajo.

Verificaciones ejecutadas:
- `npm.cmd run build` paso correctamente e incluyo la ruta `/dashboard`.

Verificaciones no ejecutadas o no completadas:
- Pendiente validar en navegador porque no se solicito reiniciar Docker ni abrir servidor.

### 2026-06-17 - Mensajes de error amigables

Que se hizo:
- Se ajusto el manejo global de errores del frontend para evitar mensajes tecnicos como `Error HTTP`, JSON crudo o validaciones internas.
- Se agregaron mensajes amigables para:
  - sesion vencida
  - permisos insuficientes
  - datos incompletos o incorrectos
  - recursos no encontrados
  - conflictos de informacion
  - errores internos
- Se tradujeron validaciones comunes de formularios a campos entendibles para usuario final.
- Se ajustaron mensajes del importador XML para explicar problemas de factura sin lenguaje tecnico.
- Se ajustaron mensajes de descarga XML para explicar falta de archivo o permisos.

Que falta:
- Revisar visualmente con errores reales del backend para afinar textos segun casos de uso.
- Agregar mas traducciones de campos si aparecen nuevos formularios.

Archivos modificados:
- `frontend/lib/api.ts`
- `frontend/lib/inventory-api.ts`
- `frontend/components/inventory/inventory-dashboard.tsx`
- `TASK_Inventario.md`

Puntos para integrar luego con produccion:
- La capa global de errores tambien beneficia a produccion y usuarios porque todos usan `apiRequest`.

Docker:
- Sin cambios requeridos.

Reglas de `SKILL.md` aplicadas:
- Se mejoro la comunicacion de errores para usuarios operativos sin conocimiento tecnico.
- Se mantuvo la logica centralizada para evitar mensajes inconsistentes entre modulos.

Verificaciones ejecutadas:
- `npm.cmd run build` paso correctamente.

Verificaciones no ejecutadas o no completadas:
- Pendiente validar en navegador porque no se solicito reiniciar Docker ni abrir servidor.

# CLAUDE.md

# Sistema ERP Web para Joyería

## 1. Contexto del Proyecto

Este proyecto consiste en desarrollar un sistema ERP web para una joyería. El sistema permitirá controlar de forma centralizada los procesos de producción, inventario, materia prima, productos en proceso, productos terminados, merma, reportes, usuarios, seguridad y trazabilidad de operaciones.

El sistema debe ser accesible desde cualquier lugar mediante Internet, utilizando un navegador web y autenticación segura con usuario y contraseña.

El flujo fue ajustado: ya no existe un empleado responsable dentro del proceso. El único usuario operativo que registra la producción es el jefe de producción. Por lo tanto, no se debe quemar en código ningún campo obligatorio de empleado responsable para la orden de producción.

---

## 2. Objetivo General

Desarrollar una aplicación web tipo ERP para joyería que permita gestionar de manera segura y escalable:

- Materias primas como oro, plata, piedras, insumos y materiales auxiliares.
- Productos terminados como anillos, cadenas, aretes, pulseras, dijes u otros artículos.
- Producción mediante procesos configurables.
- Etapas de fabricación totalmente dinámicas.
- Control de inventario.
- Control de merma.
- Registro de pesos esperados y reales.
- Trazabilidad completa de cada orden de producción.
- Reportes administrativos y operativos.
- Seguridad, auditoría y control de acceso.

---

## 3. Principio Fundamental del Sistema

El sistema debe construirse con un constructor genérico de procesos.

No se deben quemar procesos en código como:

- Fundición
- Laminado
- Corte
- Pulido
- Engaste
- Baño
- Empaque

Estos nombres pueden existir como datos en la base de datos, pero nunca como lógica fija dentro del backend o frontend.

El administrador debe poder crear, editar y ordenar los procesos desde el sistema. De esta forma, si en el futuro la joyería agrega nuevos procesos, cambia el orden de fabricación o maneja otro tipo de producto, el sistema seguirá funcionando sin modificar el código fuente.

---

## 4. Stack Tecnológico Recomendado

### Frontend

- Next.js
- React
- TypeScript
- TailwindCSS
- React Hook Form
- Zod
- TanStack Query
- Axios
- Recharts

### Backend

- Python 3.12
- FastAPI
- SQLAlchemy 2.0
- Alembic
- Pydantic v2
- JWT para autenticación
- Bcrypt para contraseñas
- Redis para control de solicitudes y caché opcional
- APScheduler o Celery para tareas programadas

### Base de Datos

- PostgreSQL

### Infraestructura

- VPS Ubuntu Server
- Docker
- Docker Compose
- Nginx
- Certificado SSL con HTTPS
- Backups automáticos
- Firewall del servidor

---

## 5. Arquitectura General

La arquitectura será de tres capas:

```text
Usuario / Navegador
        ↓
Frontend Web Next.js
        ↓
API REST FastAPI
        ↓
Base de Datos PostgreSQL
```

El frontend no debe conectarse directamente a la base de datos. Toda operación debe pasar obligatoriamente por la API del backend.

---

## 6. Roles del Sistema

### 6.1 Administrador

Tiene acceso completo al sistema.

Permisos principales:

- Crear usuarios.
- Editar usuarios.
- Activar o desactivar usuarios.
- Crear roles.
- Asignar permisos.
- Configurar materias primas.
- Configurar productos.
- Configurar unidades de medida.
- Configurar recetas o composiciones.
- Configurar procesos genéricos.
- Configurar etapas por proceso.
- Configurar límites de merma.
- Gestionar inventario.
- Ver reportes.
- Ver auditoría.

---

### 6.2 Jefe de Producción

Usuario encargado de registrar todo el flujo productivo.

Permisos principales:

- Crear órdenes de producción.
- Seleccionar producto a fabricar.
- Ingresar cantidad a fabricar.
- Iniciar producción.
- Avanzar etapas.
- Registrar pesos esperados y reales.
- Registrar merma.
- Finalizar producción.
- Consultar inventario.
- Consultar reportes de producción.

Restricciones:

- No gestiona usuarios.
- No elimina movimientos de inventario.
- No modifica configuraciones generales.
- No modifica roles ni permisos.

---

### 6.3 Jefe de Inventario

Usuario encargado del control de entradas, salidas y ajustes de inventario.

Permisos principales:

- Registrar entradas de materia prima.
- Registrar salidas de productos terminados.
- Registrar ajustes autorizados.
- Consultar stock.
- Ver movimientos de inventario.
- Importar documentos o facturas XML si aplica.
- Generar reportes de inventario.

Restricciones:

- No crea órdenes de producción.
- No modifica procesos.
- No gestiona usuarios.

---

## 7. Módulos del Sistema

## 7.1 Módulo de Autenticación

Funcionalidades:

- Inicio de sesión.
- Cierre de sesión.
- Refresh token.
- Recuperación de contraseña.
- Cambio de contraseña.
- Bloqueo temporal por intentos fallidos.
- Control de sesiones activas.

Seguridad:

- Autenticación mediante JWT.
- Access token de corta duración.
- Refresh token de mayor duración, almacenado de forma segura.
- Contraseñas cifradas con bcrypt o Argon2.
- Cookies HttpOnly y Secure si se usa autenticación basada en cookies.
- Protección CSRF si se usan cookies.
- Revocación de tokens al cerrar sesión.

---

## 7.2 Módulo de Usuarios, Roles y Permisos

Debe permitir administrar el acceso al sistema mediante RBAC.

RBAC significa Role Based Access Control, es decir, control de acceso basado en roles.

Entidades principales:

- Usuarios.
- Roles.
- Permisos.
- Relación usuario-rol.
- Relación rol-permiso.

Ejemplos de permisos:

- users.create
- users.update
- users.disable
- products.read
- products.create
- products.update
- inventory.read
- inventory.adjust
- production.create
- production.start
- production.finish
- reports.read
- audit.read

---

## 7.3 Módulo de Materias Primas

Este módulo administra materiales usados en la joyería.

Ejemplos:

- Oro 18K.
- Oro 14K.
- Plata 925.
- Piedras preciosas.
- Piedras semipreciosas.
- Broches.
- Cadenas base.
- Soldadura.
- Químicos.
- Empaques.

Campos principales:

- Código.
- Nombre.
- Tipo de material.
- Unidad de medida.
- Stock actual.
- Stock mínimo.
- Costo unitario.
- Estado.

El stock no debe actualizarse manualmente editando el campo stock_actual directamente. Debe actualizarse mediante movimientos de inventario para mantener trazabilidad.

---

## 7.4 Módulo de Productos Terminados

Este módulo administra los artículos finales de la joyería.

Ejemplos:

- Anillo modelo A.
- Pulsera modelo B.
- Cadena modelo C.
- Aretes modelo D.
- Dije modelo E.

Campos principales:

- Código.
- Nombre.
- Descripción.
- Categoría.
- Unidad de medida.
- Estado.
- Precio referencial opcional.

El stock de productos terminados debe actualizarse automáticamente cuando una orden de producción se finaliza.

---

## 7.5 Módulo de Composición o Receta del Producto

Cada producto puede tener una composición base.

Ejemplo genérico:

Producto: Anillo Modelo A

Composición:

- Oro 18K: 5 gramos.
- Piedra principal: 1 unidad.
- Piedra secundaria: 2 unidades.
- Soldadura: 0.10 gramos.

La composición debe ser configurable y versionable.

No se debe asumir que todos los productos usan los mismos materiales.

Cada producto puede tener:

- Una composición activa.
- Versiones históricas.
- Materiales variables.
- Cantidades esperadas por unidad.

---

## 7.6 Constructor Genérico de Procesos

Este es uno de los módulos más importantes.

El sistema debe permitir crear procesos dinámicos desde la interfaz administrativa.

Un proceso es una plantilla de fabricación.

Ejemplo:

Proceso: Fabricación de anillo con piedra

Etapas:

1. Preparación de material.
2. Fundición.
3. Moldeado.
4. Limado.
5. Engaste.
6. Pulido.
7. Control de calidad.
8. Empaque.

Estas etapas no deben estar quemadas en código.

Campos de un proceso:

- Nombre.
- Descripción.
- Producto asociado opcional.
- Estado.
- Versión.

Campos de una etapa:

- Nombre.
- Descripción.
- Orden.
- Tiempo estimado en minutos.
- Requiere peso inicial.
- Requiere peso final.
- Permite registrar merma.
- Requiere observación.
- Es obligatoria.
- Estado.

La lógica debe leer las etapas desde la base de datos.

---

## 7.7 Módulo de Producción

El jefe de producción crea una orden de producción.

Datos de entrada:

- Producto a fabricar.
- Cantidad a fabricar.
- Proceso a utilizar.
- Observación opcional.

El sistema debe calcular automáticamente:

- Materiales requeridos.
- Stock disponible.
- Stock faltante.
- Peso esperado.
- Etapas del proceso.

Estados de una orden de producción:

- BORRADOR.
- PENDIENTE.
- EN_PROCESO.
- PAUSADA.
- FINALIZADA.
- CANCELADA.

La orden de producción no debe tener empleado responsable obligatorio. El usuario creador y operador será el jefe de producción autenticado.

---

## 7.8 Flujo de Producción

### Paso 1: Crear orden

El jefe de producción selecciona:

- Producto.
- Cantidad.
- Proceso.

### Paso 2: Calcular materiales

El sistema consulta la composición del producto y calcula los materiales requeridos.

### Paso 3: Validar inventario

El sistema valida si existe stock suficiente.

Si no hay stock suficiente, el sistema debe mostrar alerta y puede bloquear el inicio según configuración.

### Paso 4: Generar etapas

El sistema copia las etapas del proceso hacia la orden de producción.

Esto es importante porque, aunque el proceso se edite en el futuro, la orden histórica debe conservar las etapas con las que fue creada.

### Paso 5: Iniciar producción

El jefe de producción inicia la orden.

Se registra:

- Fecha de inicio.
- Hora de inicio.
- Usuario que inició.

### Paso 6: Ejecutar etapas

Cada etapa puede registrar:

- Fecha de inicio.
- Fecha de finalización.
- Peso inicial.
- Peso final.
- Merma.
- Observaciones.
- Estado.

### Paso 7: Controlar tiempos

El sistema compara tiempo real contra tiempo estimado.

Si una etapa excede el tiempo esperado:

- Se marca como retrasada.
- Se registra evento.
- Se puede enviar notificación.

### Paso 8: Finalizar producción

Al finalizar:

- Se descuenta la materia prima consumida.
- Se registra la merma.
- Se incrementa el inventario de producto terminado.
- Se genera resumen de producción.
- Se bloquea edición crítica de la orden.

---

## 7.9 Módulo de Merma

La merma es la diferencia entre el peso esperado y el peso real obtenido.

Fórmula:

```text
merma = peso_esperado - peso_real
```

Porcentaje:

```text
porcentaje_merma = (merma / peso_esperado) * 100
```

El sistema debe registrar:

- Merma por etapa.
- Merma total por orden.
- Porcentaje de merma.
- Material relacionado.
- Observaciones.
- Usuario que registró.

Debe existir un límite de merma configurable.

Si la merma supera el límite permitido:

- Se muestra alerta.
- Se registra incidencia.
- Se marca para revisión.

---

## 7.10 Módulo de Inventario

El inventario se divide en:

- Materia prima.
- Productos en proceso.
- Productos terminados.

Todo cambio de inventario debe realizarse por movimientos, no por actualización directa manual del stock.

Tipos de movimiento:

- ENTRADA.
- SALIDA.
- AJUSTE_POSITIVO.
- AJUSTE_NEGATIVO.
- CONSUMO_PRODUCCION.
- INGRESO_PRODUCCION.
- MERMA.

Cada movimiento debe guardar:

- Tipo.
- Material o producto.
- Cantidad.
- Unidad de medida.
- Costo unitario opcional.
- Motivo.
- Usuario.
- Fecha.
- Referencia a orden de producción si aplica.

---

## 7.11 Módulo de Reportes

Reportes mínimos:

- Producción diaria.
- Producción mensual.
- Producción por producto.
- Producciones en proceso.
- Producciones retrasadas.
- Merma por etapa.
- Merma por producto.
- Merma histórica.
- Inventario actual.
- Kardex de materia prima.
- Kardex de producto terminado.
- Stock mínimo.
- Movimientos por fecha.

Exportación:

- PDF.
- Excel.
- CSV.

---

## 7.12 Dashboard

Indicadores principales:

- Órdenes activas.
- Órdenes finalizadas del mes.
- Producciones retrasadas.
- Merma total del mes.
- Productos terminados disponibles.
- Materias primas con stock bajo.
- Material más consumido.
- Producto más fabricado.

---

## 8. Seguridad del Sistema

La seguridad debe ser parte central del desarrollo.

## 8.1 Autenticación con JWT

- Usar JWT para autenticar solicitudes.
- Access token con duración corta, por ejemplo 15 a 30 minutos.
- Refresh token con duración mayor, por ejemplo 7 a 30 días.
- Guardar refresh tokens de forma segura.
- Permitir revocar refresh tokens.
- Incluir expiración en todos los tokens.
- Validar firma, expiración y tipo de token.

## 8.2 Contraseñas

- Nunca guardar contraseñas en texto plano.
- Usar bcrypt o Argon2.
- Exigir contraseñas seguras.
- Bloquear temporalmente tras varios intentos fallidos.
- Registrar intentos de inicio de sesión sospechosos.

## 8.3 Validación contra SQL Injection

- No construir consultas SQL concatenando strings del usuario.
- Usar ORM SQLAlchemy con parámetros seguros.
- Usar consultas parametrizadas cuando se use SQL manual.
- Validar todos los datos de entrada con Pydantic.
- Validar tipos, rangos, longitudes y formatos.
- Rechazar campos inesperados.
- Escapar salidas cuando corresponda.

## 8.4 Rate Limiting

Implementar límite de solicitudes para proteger la API.

Ejemplos:

- Login: máximo 5 intentos por minuto por IP.
- Recuperación de contraseña: máximo 3 solicitudes por hora.
- API general: máximo 100 solicitudes por minuto por usuario.
- Endpoints sensibles: límites más estrictos.

Se recomienda usar Redis para guardar contadores temporales.

## 8.5 Control de Acceso

- Implementar RBAC.
- Validar permisos en backend, no solo en frontend.
- Cada endpoint debe verificar rol y permiso.
- El frontend solo oculta opciones, pero la seguridad real vive en el backend.

## 8.6 Protección de API

- HTTPS obligatorio.
- CORS configurado únicamente para dominios permitidos.
- Headers de seguridad con Nginx.
- Tamaño máximo de payload.
- Validación de archivos subidos.
- Restricción de tipos MIME.
- Escaneo básico o validación de XML.

## 8.7 Auditoría

Registrar en logs de auditoría:

- Inicio de sesión.
- Cierre de sesión.
- Creación de usuarios.
- Cambios de permisos.
- Creación de órdenes.
- Inicio y finalización de producción.
- Movimientos de inventario.
- Ajustes manuales.
- Cambios de configuración.
- Errores críticos.

Cada log debe guardar:

- Usuario.
- Acción.
- Tabla afectada.
- ID afectado.
- Fecha y hora.
- IP.
- User agent.
- Datos anteriores opcionales.
- Datos nuevos opcionales.

## 8.8 Backups

- Backup automático diario de PostgreSQL.
- Retención mínima de 7 a 30 días.
- Backup antes de despliegues importantes.
- Pruebas periódicas de restauración.

## 8.9 Variables de Entorno

No guardar secretos en el código.

Usar variables como:

- DATABASE_URL
- JWT_SECRET_KEY
- JWT_REFRESH_SECRET_KEY
- CORS_ORIGINS
- SMTP_HOST
- SMTP_USER
- SMTP_PASSWORD
- REDIS_URL

---

## 9. API REST Principal

Endpoints sugeridos:

```text
/api/auth/login
/api/auth/refresh
/api/auth/logout
/api/auth/me

/api/users
/api/roles
/api/permissions

/api/raw-materials
/api/products
/api/product-compositions
/api/process-templates
/api/process-stages

/api/production-orders
/api/production-orders/{id}/start
/api/production-orders/{id}/pause
/api/production-orders/{id}/finish
/api/production-orders/{id}/cancel
/api/production-order-stages/{id}/start
/api/production-order-stages/{id}/finish

/api/inventory/movements
/api/inventory/raw-materials
/api/inventory/products

/api/waste
/api/reports
/api/dashboard
/api/audit-logs
```

---

## 10. Reglas Técnicas para Claude Code

Claude debe respetar estas reglas durante el desarrollo:

1. No quemar nombres de procesos en código.
2. No quemar etapas de joyería en código.
3. Todo proceso debe salir desde la base de datos.
4. Toda etapa debe ser configurable.
5. No crear un campo obligatorio de empleado responsable en producción.
6. La producción debe asociarse al usuario autenticado que la crea e inicia.
7. Todo cambio de inventario debe generar movimiento.
8. No actualizar stock sin movimiento histórico.
9. Todos los endpoints deben validar JWT.
10. Todos los endpoints sensibles deben validar permisos.
11. No concatenar SQL con datos del usuario.
12. Usar validaciones Pydantic.
13. Usar migraciones Alembic.
14. Usar transacciones para producción e inventario.
15. Registrar auditoría en acciones críticas.
16. Mantener separación entre frontend, backend y base de datos.
17. Crear código modular.
18. Crear servicios para lógica de negocio.
19. Crear repositorios o capa de acceso a datos.
20. Crear pruebas para reglas críticas.

---

## 11. Estructura Recomendada del Backend

```text
backend/
  app/
    main.py
    core/
      config.py
      security.py
      rate_limit.py
      permissions.py
    db/
      session.py
      base.py
    models/
      user.py
      role.py
      product.py
      raw_material.py
      process.py
      production.py
      inventory.py
      audit.py
    schemas/
      auth.py
      user.py
      product.py
      raw_material.py
      process.py
      production.py
      inventory.py
    api/
      v1/
        auth.py
        users.py
        products.py
        raw_materials.py
        processes.py
        production.py
        inventory.py
        reports.py
    services/
      auth_service.py
      production_service.py
      inventory_service.py
      waste_service.py
      report_service.py
    repositories/
      user_repository.py
      production_repository.py
      inventory_repository.py
    utils/
      audit.py
      dates.py
      exceptions.py
```

---

## 12. Estructura Recomendada del Frontend

```text
frontend/
  app/
    login/
    dashboard/
    usuarios/
    inventario/
    materias-primas/
    productos/
    procesos/
    produccion/
    reportes/
  components/
    ui/
    forms/
    tables/
    layout/
  lib/
    api.ts
    auth.ts
    validators.ts
  hooks/
  stores/
  types/
```

---

## 13. Consideraciones de Desarrollo

- Primero construir autenticación y roles.
- Luego construir catálogo de materias primas y productos.
- Después construir el constructor genérico de procesos.
- Luego construir producción.
- Después conectar producción con inventario.
- Luego agregar merma.
- Finalmente reportes, dashboard y auditoría.

---

## 14. Orden Recomendado de Implementación

1. Configuración inicial del proyecto.
2. Base de datos PostgreSQL.
3. Autenticación JWT.
4. Roles y permisos.
5. Usuarios.
6. Materias primas.
7. Productos.
8. Composición de productos.
9. Constructor genérico de procesos.
10. Órdenes de producción.
11. Etapas dinámicas de producción.
12. Inventario y movimientos.
13. Control de merma.
14. Reportes.
15. Dashboard.
16. Auditoría.
17. Seguridad avanzada.
18. Pruebas.
19. Despliegue.
20. Capacitación.

---

## 15. Criterios de Aceptación

El sistema se considera completo cuando:

- El administrador puede configurar productos, materiales y procesos.
- El jefe de producción puede crear una orden sin seleccionar empleado responsable.
- Las etapas se generan dinámicamente desde el proceso configurado.
- El sistema calcula materiales requeridos.
- El sistema valida stock disponible.
- El sistema registra inicio y fin de cada etapa.
- El sistema calcula merma.
- El sistema actualiza inventario mediante movimientos.
- El sistema genera reportes.
- El sistema tiene autenticación JWT.
- El sistema controla permisos por rol.
- El sistema valida entradas contra SQL Injection.
- El sistema limita solicitudes abusivas.
- El sistema registra auditoría.
- El sistema funciona en producción mediante HTTPS.

# Rediseño visual — "Instrumento de precisión"

Fecha: 2026-07-03
Alcance: todo el sistema (login, dashboards, inventario, reportes y chrome común).

## 1. Contexto

El frontend actual usa el look por defecto de "joyería oro/crema" (fondo
`#faf8f4`, oro `#b8893a`, sidebar grafito). Se lee como template. `globals.css`
tiene ~3735 líneas. Se rediseña con una identidad propia, data-first, aplicada a
todo el sistema desde un único lenguaje de diseño.

Dirección aprobada: **instrumento de precisión** — base clara tipo papel
técnico, tinta ónix, oro solo como hilo, tipografía de punzón grabado, y una
signature de escala de calibre para todo valor medido.

## 2. Lenguaje de diseño (fuente de verdad de tokens)

### 2.1 Color

```
--paper      #FBFAF7   fondo hueso
--surface    #FFFFFF   tarjeta / superficie
--surface-2  #F4F1EA   superficie hundida (inputs, filas alternas)
--ink        #17150F   ónix — texto principal
--muted      #6E675B   texto secundario / labels
--line       #E4DFD3   hairline: bordes, ticks, divisores (1px)
--gold       #A67C34   HILO: bordes finos, punzón, subrayado de métrica
--gold-deep  #7A5A22   texto/acento oro legible sobre papel (WCAG AA)
--danger     #B23B3B   merma sobre límite / error
--success    #2F7D5B   en tolerancia / ok
--warning    #9A6B1E   por revisar
```

Regla dura del oro: **nunca** relleno ni gradiente. Solo línea de 1px, glifo de
punzón, o subrayado de una métrica clave. Esto separa la identidad del template
"joyería oro". Cualquier uso de oro como fondo es un bug de diseño.

Contraste: todo texto cumple WCAG AA. Oro como texto usa `--gold-deep`, no
`--gold`.

### 2.2 Tipografía

```
Display  Saira Condensed  600/700  — MAYÚSCULAS, tracking positivo.
                                      Títulos de sección, eyebrows, números de
                                      etapa, cabeceras de tarjeta-ticket.
Body     Hanken Grotesk   400/500/600 — texto general, labels, botones.
Mono     IBM Plex Mono    500  — TODOS los números (stock, pesos, %, códigos,
                                  cantidades), con figuras tabulares alineadas.
```

Carga con `next/font` (self-host, sin CDN). Escala tipográfica definida en el
plan de implementación. Regla: ningún número operativo se renderiza en Hanken;
las cifras van siempre en IBM Plex Mono para alineación en columnas.

### 2.3 Layout / chrome

- Chrome claro (no más sidebar grafito). El sidebar es un índice grabado en
  papel; el ítem activo se marca con un **hilo de oro de 2px** en el borde
  izquierdo (metáfora del cursor de calibre).
- Tarjetas = "ticket de ensayo": borde hairline, marcas de registro en las
  esquinas, cabecera con eyebrow grabado (Saira Condensed).
- Divisores y separadores como líneas finas; nunca sombras pesadas. Sombra
  máxima muy sutil (`0 1px 0` / difusa mínima).
- Radios de borde pequeños y consistentes (2–4px), coherentes con lo grabado.

### 2.4 Signature — Escala de calibre

Elemento memorable único. Todo valor medido se dibuja como una **regla de
precisión**: una fila de ticks finos con un marcador de oro en la posición
actual. Sustituye a las barras de progreso planas.

Aplicaciones:
- **Avance de producción**: ticks = etapas; marcador de oro = etapa actual.
- **Merma vs límite**: la escala muestra una marca fija de límite (`△`); si el
  marcador supera la marca, el tramo excedido entra en `--danger`.
- **Stock vs mínimo**: marca fija en el mínimo; marcador en el stock actual;
  por debajo del mínimo → `--danger`.

Estados (EN PROCESO, FINALIZADA, etc.) = **punzón** discreto: label en
MAYÚSCULAS (Saira Condensed) dentro de un marco fino. Callado; la escala de
calibre es la única pieza que grita.

Restricción de sobriedad: una sola signature. Nada más compite por atención.

## 3. Aplicación por superficie

Todas derivan de la sección 2. Orden de implementación:

1. **Tokens + fuentes + chrome** (`globals.css`, layout, sidebar). Base para
   todo lo demás.
2. **Login** — identidad concentrada: wordmark grabado, un campo limpio,
   hilo de oro como único acento. Mensajes de error en la voz del sistema,
   sin apología.
3. **Dashboards** — tarjetas-ticket; avance y merma con escala de calibre;
   estados como punzón; KPIs con número mono y subrayado de oro.
4. **Vista inventario** — tabla densa legible: filas con figuras mono
   tabulares, stock vs mínimo con escala de calibre, hairlines en vez de
   zebra pesada.
5. **Reportes nuevos** — layout de "ficha de ensayo": tablas mono, totales
   subrayados en oro, export (PDF/Excel/CSV) coherente. (Los reportes concretos
   a incluir se definen en el plan; mínimo: producción, merma, kardex,
   inventario actual, stock mínimo.)

## 4. Enfoque de implementación

- Refactor de `globals.css` a un sistema de tokens único; los valores viejos
  (`--primary` oro, sidebar grafito) se reemplazan, no se acumulan. Reducir el
  archivo donde sea posible.
- Componente de **escala de calibre** reutilizable (una implementación, usada en
  avance, merma y stock) para no duplicar la signature.
- Componente de **punzón de estado** reutilizable.
- Cambios superficie por superficie, cada una verificable en el navegador.

## 5. Piso de calidad (no negociable)

- Responsive hasta móvil; tablas densas con scroll horizontal contenido.
- Foco de teclado visible en todo control.
- `prefers-reduced-motion` respetado; animación mínima y con propósito
  (revelado sutil, hover discreto). Nada de movimiento decorativo.
- Contraste WCAG AA en texto y estados.
- Sin CDN externas (fuentes self-host), coherente con la CSP del proyecto.

## 6. Fuera de alcance

- Lógica de negocio, endpoints y modelos de datos no cambian.
- No se agregan reportes con datos que el backend aún no expone; los "reportes
  nuevos" se limitan a lo que la API ya entrega, salvo que el plan indique
  endpoints adicionales.

# Rediseño visual "Oro & Grafito" — ERP Joyería

**Fecha:** 2026-06-30
**Alcance:** Solo estética. Cero cambios de lógica de negocio, datos, endpoints o flujos.

## Objetivo

Retematizar el frontend del ERP de joyería desde un look corporativo azul/Arial
genérico hacia una identidad premium "Oro & Grafito": fondo crema, acento dorado,
sidebar grafito oscuro, títulos serif. Debe seguir siendo un ERP operativo legible
para uso diario prolongado.

## Por qué es seguro (sin tocar lógica)

Todo el sistema visual está centralizado:
- Un único `frontend/app/globals.css` (~2638 líneas) con variables CSS + nombres de
  clase globales.
- El JSX usa esos nombres de clase como strings literales.

Retematizar = editar tokens y reglas en `globals.css`. Los nombres de clase no
cambian → el JSX y la lógica quedan intactos. Cambios mínimos en markup solo para
marca (monograma) y para cablear fuentes.

## Tokens (`:root`)

| Token | Antes | Después |
|---|---|---|
| `--background` | `#f5f7fb` | `#FAF8F4` crema |
| `--surface` | `#ffffff` | `#FFFFFF` |
| `--surface-muted` | `#f1f5f9` | `#F3EFE8` |
| `--border` | `#d8e0ea` | `#E7DFD2` |
| `--text` | `#172033` | `#1C1A17` grafito |
| `--muted` | `#62708a` | `#7A7166` |
| `--primary` | `#174ea6` | `#B8893A` oro |
| `--primary-strong` | `#123a7a` | `#8A6427` |
| `--success` | `#0f7b55` | `#2F7D5B` |
| `--warning` | `#9a5b00` | `#9A6B1E` |
| `--danger` | `#ad2f2f` | `#B23B3B` |
| `--pending` | `#516071` | `#6E665B` |
| `--shadow` | azul fría | `0 8px 22px rgba(28,26,23,.08)` cálida |

Nuevos tokens sidebar: `--sidebar-bg #1C1A17`, `--sidebar-text #C9C0B2`,
`--sidebar-active rgba(184,137,58,.16)`, `--sidebar-border rgba(255,255,255,.07)`.

Reemplazar todos los azules hard-codeados dispersos (`#e8f0fe`, `#2f7dd5`,
`#3b82f6`, `#174ea6`, `#123a7a`, `#9db7f0`, `#c7d7f5`, `#f4f8ff`, `#f6f9ff`,
`#e8f0fe`, gradientes azules de barras/progreso) por equivalentes oro/crema.
Verdes y rojos semánticos de estado se conservan (significado funcional).

## Tipografía

- Cargar vía `next/font/google` en `layout.tsx`:
  - **Cormorant Garamond** (serif) → títulos: `h1`, `.brandName`, `.metricValue`,
    `.panelTitle`, `.runCardTitle strong`, `.loginBrand h1`, números grandes de stat.
  - **Inter** (sans) → cuerpo, tablas, labels, botones, badges.
- Exponer como CSS vars (`--font-serif`, `--font-sans`); reemplazar
  `font-family: Arial, Helvetica, sans-serif` del `body` por `var(--font-sans)`.
- Números tabulares (`font-variant-numeric: tabular-nums`) en `.table`, `.metricValue`,
  `.productionStatCard strong`, stats — alineación de cifras.

## Sidebar + topbar

- Sidebar grafito oscuro, texto champán tenue, hairlines claros translúcidos.
- `.navItemActive`: fondo oro translúcido + borde-izquierdo oro, texto champán claro.
- `.brandMark`: caja con degradado oro + monograma serif.
- `.brandName` serif; `.brandMeta` champán tenue.
- Topbar crema con hairline inferior; título serif.

## Componentes

- `.buttonPrimary`: fondo oro, texto grafito, hover oro fuerte.
- `:focus-visible` ring oro accesible en controles.
- Radios ligeramente mayores (8→10/12px) en cards/modales/tiles para sensación premium.
- Pills/badges/status re-tonalizados a la paleta cálida; estados semánticos intactos.
- Sombras cálidas suaves.
- Gradientes de barra/progreso → oro.

## Login

Panel centrado sobre crema con sutil viñeta/realce oro, marca serif, mismo markup
y mismos campos (sin cambios de form/lógica).

## Archivos a editar

- `frontend/app/globals.css` — retheme (núcleo del trabajo).
- `frontend/app/layout.tsx` — cablear `next/font` (Cormorant + Inter), aplicar var de fuente al body.
- `frontend/components/layout/app-shell.tsx` — monograma de marca (solo markup visual).
- `frontend/app/login/page.tsx` — monograma de marca (solo markup visual).

## No-objetivos

- Sin cambios de estructura de datos, llamadas API, validaciones, estados ni rutas.
- Sin renombrar clases CSS (rompería el JSX).
- Sin agregar librerías de UI ni Tailwind.
- Sin refactor no relacionado.

## Criterio de aceptación

- Todas las pantallas heredan la paleta oro/grafito automáticamente.
- Sidebar oscuro con acento oro; títulos serif; cuerpo Inter.
- No quedan azules corporativos visibles (salvo estados semánticos intencionales).
- App compila (`next build`) y comportamiento idéntico al previo.

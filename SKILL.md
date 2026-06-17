---
name: erp-jewelry-web-design
description: Global frontend design and implementation standard for this jewelry ERP. Use when any agent builds or changes frontend screens, layouts, shared UI, module pages, dashboards, tables, forms, state views, navigation, or user workflows for production, inventory, auth, users, reports, documents, dashboard, or any other ERP module.
---

# ERP Jewelry Web Design

## Purpose

Build one integrated SaaS ERP interface for the whole system, not isolated module screens.

All frontend work must feel like one product: same navigation model, spacing, typography, controls, states, table behavior, form behavior, and interaction patterns across production, inventory, documents, reports, dashboard, users, security, and auth.

## Product Feel

Use a professional operational SaaS style:

- Dense but readable screens.
- Sidebar navigation plus top header when a full app shell exists.
- Quiet color palette with strong hierarchy.
- Compact KPIs, tables, filters, forms, drawers, dialogs, badges, toasts, skeletons, empty states, and error states.
- Functional screens first; no marketing landing pages inside the ERP.
- No decorative orbs, bokeh blobs, heavy gradients, oversized heroes, or illustrative filler.

The ERP is for repeated daily operations. Prioritize scanning, comparison, and fast action.

## Shared Frontend Architecture

Prefer shared UI before duplicating module UI.

Use these shared locations when the component is useful across modules:

- `frontend/components/shared`
- `frontend/types/shared`
- `frontend/components/ui`
- `frontend/components/layout`
- `frontend/hooks`
- `frontend/lib`

Use module locations only for module-specific pieces:

- `frontend/app/produccion`
- `frontend/components/production`
- `frontend/types/production`
- `frontend/app/inventario`
- `frontend/components/inventory`
- `frontend/types/inventory`

When creating a shared frontend component, update the active module TASK with:

- why it is shared
- which module consumes it now
- which module is expected to reuse it later

## Module Integration Rules

Production and inventory frontends must look and behave as sibling workflows.

Production screens should expose inventory integration points without implementing inventory logic:

- material availability status
- reservation status
- finished production handoff status
- pending inventory integration messages

Inventory screens should expose production integration points without implementing production logic:

- stock availability for production
- reserved material references
- production consumption movements
- finished product intake movements

Do not hardcode jewelry process names, stage names, material names, or product categories in UI logic. These can appear only as data returned by the API or local mock data clearly marked as temporary demo data.

## Page Pattern

Every operational page should include, when applicable:

- title
- short operational description
- primary action
- secondary actions
- filters/search
- table or list
- loading state
- empty state
- error state
- row actions
- detail drawer or dialog
- destructive action confirmation

Avoid explaining the UI inside the app with instructional marketing text. Use labels, tooltips, empty states, and validation messages.

## Forms

Use React Hook Form and Zod when available.

Every form should have:

- typed input model
- validation schema
- initial values
- inline field errors
- submit loading state
- disabled submit while saving
- success/error feedback
- no secrets or critical permission logic in frontend

Keep forms modular. Extract schemas, types, hooks, and services when the module grows.

## Tables

Use TanStack Table when available.

Tables should support:

- search or filters
- sorting where useful
- pagination
- stable columns
- row actions
- status badges
- empty state
- loading state
- error state

Actions that destroy, cancel, close, or finalize business records must ask for confirmation.

## Visual Controls

Use familiar controls:

- icon buttons for common actions
- text buttons for clear commands
- tabs for alternate views
- segmented controls for modes
- switches or checkboxes for booleans
- selects or menus for option sets
- sliders, steppers, or inputs for numeric values
- badges for statuses

Use Lucide icons when an icon library is available. Do not manually draw icons unless there is no library or the project has no icon dependency yet.

## Layout Constraints

Keep interface elements stable and responsive:

- no text overlap
- no viewport-width font scaling
- no negative letter spacing
- no nested cards
- card radius 8px or less unless the design system says otherwise
- stable dimensions for boards, tables, counters, toolbar buttons, and tiles
- readable mobile layouts with actions still reachable

Use full-width bands or direct layouts for page sections. Use cards for repeated entities, summaries, modals, drawers, and compact dashboard widgets.

## State Language

Use consistent Spanish UI labels because the project is Spanish-first.

Recommended status labels:

- Borrador
- Pendiente
- En proceso
- Pausada
- Finalizada
- Cancelada
- Disponible
- Reservado
- Sin stock
- Pendiente de integracion

Keep backend enum values separate from display labels.

## Implementation Workflow

Before frontend edits:

1. Read `SKILL.md`.
2. Identify the active module and its allowed frontend paths.
3. Check whether a shared component already exists.
4. Prefer shared components for layout, tables, filters, badges, empty states, loading states, dialogs, drawers, and toasts.
5. Add module-specific components only when the behavior is unique to that module.
6. Keep frontend service calls isolated from UI components.
7. Update the module TASK with frontend files, shared files, Docker impact, and integration points.

## Docker Impact

If frontend work adds dependencies, package scripts, frontend dev server, environment variables, or ports, update Docker files and README in the same session:

- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- package files when they exist
- `README.md`

If no Docker change is required, record `Docker: sin cambios requeridos` in the active module TASK.

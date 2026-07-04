"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Trash2, X } from "lucide-react";
import {
  CatalogSegment,
  SegmentKind,
  createCatalogSegment,
  deleteCatalogSegment,
  listCatalogSegments
} from "@/lib/catalog-api";

export function CatalogDashboard() {
  const queryClient = useQueryClient();
  const { data: segments = [], isLoading } = useQuery({
    queryKey: ["catalog"],
    queryFn: listCatalogSegments,
  });
  const [error, setError] = useState<string | null>(null);

  const [newMaterial, setNewMaterial] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [modelCat, setModelCat] = useState("");
  const [newModel, setNewModel] = useState("");

  const [lookup, setLookup] = useState("");
  const [lookupOpen, setLookupOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CatalogSegment | null>(null);

  const reload = () => queryClient.invalidateQueries({ queryKey: ["catalog"] });

  const materials = useMemo(() => segments.filter((s) => s.kind === "MATERIAL"), [segments]);
  const categories = useMemo(() => segments.filter((s) => s.kind === "CATEGORY"), [segments]);
  const modelsOf = (cat: string) => segments.filter((s) => s.kind === "MODEL" && s.parent_code === cat);

  async function add(kind: SegmentKind, label: string, parent: string | null, reset: () => void) {
    if (!label.trim()) return;
    setError(null);
    try {
      await createCatalogSegment({ kind, label: label.trim(), parent_code: parent });
      reset();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo agregar.");
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await deleteCatalogSegment(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar.");
    }
  }

  const decoded = useMemo(() => {
    const digits = lookup.replace(/\D/g, "");
    // Solo códigos completos: material(1)+categoría(2)+modelo(4)+9999(4) = 11 dígitos.
    if (digits.length !== 11) return null;
    const matCode = digits.slice(0, 1);
    const catCode = digits.slice(1, 3);
    const modCode = digits.slice(3, 7);
    const reserved = digits.slice(7, 11);
    return {
      matCode,
      catCode,
      modCode,
      reserved,
      material: materials.find((m) => m.code === matCode) ?? null,
      category: categories.find((c) => c.code === catCode) ?? null,
      model: segments.find((s) => s.kind === "MODEL" && s.parent_code === catCode && s.code === modCode) ?? null
    };
  }, [lookup, materials, categories, segments]);

  function SegmentTable({ rows }: { rows: CatalogSegment[] }) {
    if (rows.length === 0) return <div className="emptyState">Sin registros.</div>;
    return (
      <table className="table">
        <thead><tr><th style={{ width: "28%" }}>Código</th><th>Nombre</th><th aria-label="acciones" /></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td style={{ fontFamily: "monospace", fontWeight: 700 }}>{row.code}</td>
              <td>{row.label}</td>
              <td style={{ textAlign: "right" }}>
                <button className="iconTextButton dangerText" onClick={() => setConfirmDelete(row)} type="button">
                  <Trash2 aria-hidden="true" size={14} /> Eliminar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className="content">
      <div className="pageHeader">
        <p style={{ margin: 0, maxWidth: 560 }}>
          Código de producto: <strong>material(1) · categoría(2) · tipo/modelo(4) · 9999</strong>.
        </p>
        <form
          className="actions"
          onSubmit={(e) => { e.preventDefault(); if (decoded) setLookupOpen(true); }}
        >
          <input
            className="field"
            inputMode="numeric"
            maxLength={14}
            onChange={(e) => setLookup(e.target.value)}
            placeholder="Consultar código…"
            value={lookup}
            style={{ width: 200, fontFamily: "monospace" }}
          />
          <button className="button buttonPrimary" disabled={!decoded} title="Ingresa un código completo de 11 dígitos" type="submit">
            <Search aria-hidden="true" size={16} /> Consultar
          </button>
        </form>
      </div>

      {error ? <div className="notice noticeError"><span className="noticeInner">{error}</span></div> : null}

      {isLoading ? <section className="card panelBody"><div className="emptyState">Cargando...</div></section> : (
      <section className="catalogGrid catalogGrid3 catalogGridTall">
        <article className="card catalogCard">
          <div className="catalogCardHead"><h2 className="panelTitle">Materiales</h2><span>{materials.length} · 1 dígito</span></div>
          <form className="inlineField" onSubmit={(e) => { e.preventDefault(); void add("MATERIAL", newMaterial, null, () => setNewMaterial("")); }}>
            <input className="field" placeholder="Nuevo material" value={newMaterial} onChange={(e) => setNewMaterial(e.target.value)} />
            <button className="button buttonPrimary" type="submit"><Plus size={16} /> Agregar</button>
          </form>
          <div className="catalogScroll"><SegmentTable rows={materials} /></div>
        </article>

        <article className="card catalogCard">
          <div className="catalogCardHead"><h2 className="panelTitle">Categorías</h2><span>{categories.length} · 2 dígitos</span></div>
          <form className="inlineField" onSubmit={(e) => { e.preventDefault(); void add("CATEGORY", newCategory, null, () => setNewCategory("")); }}>
            <input className="field" placeholder="Nueva categoría" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
            <button className="button buttonPrimary" type="submit"><Plus size={16} /> Agregar</button>
          </form>
          <div className="catalogScroll"><SegmentTable rows={categories} /></div>
        </article>

        <article className="card catalogCard">
          <div className="catalogCardHead"><h2 className="panelTitle">Tipos / modelos</h2><span>4 dígitos · por categoría</span></div>
          <select className="field" value={modelCat} onChange={(e) => setModelCat(e.target.value)}>
            <option value="">Selecciona categoría</option>
            {categories.map((c) => <option key={c.id} value={c.code}>{c.code} · {c.label}</option>)}
          </select>
          {modelCat ? (
            <form className="inlineField" onSubmit={(e) => { e.preventDefault(); void add("MODEL", newModel, modelCat, () => setNewModel("")); }}>
              <input className="field" placeholder="Nuevo tipo/modelo" value={newModel} onChange={(e) => setNewModel(e.target.value)} />
              <button className="button buttonPrimary" type="submit"><Plus size={16} /> Agregar</button>
            </form>
          ) : null}
          <div className="catalogScroll">{modelCat ? <SegmentTable rows={modelsOf(modelCat)} /> : <div className="emptyState">Selecciona una categoría.</div>}</div>
        </article>
      </section>
      )}

      {lookupOpen && decoded ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Consulta de código">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2 style={{ fontFamily: "monospace", letterSpacing: 2 }}>{lookup.replace(/\D/g, "")}</h2>
                <p>Consulta de código de producto</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setLookupOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            {decoded.material && decoded.category && decoded.model && decoded.reserved === "9999" ? (
              <div className="userPreviewGrid">
                <span><strong>Material ({decoded.matCode})</strong>{decoded.material.label}</span>
                <span><strong>Categoría ({decoded.catCode})</strong>{decoded.category.label}</span>
                <span><strong>Tipo / modelo ({decoded.modCode})</strong>{decoded.model.label}</span>
                <span><strong>Reservado</strong>{decoded.reserved}</span>
              </div>
            ) : (
              <div className="emptyState" style={{ display: "grid", gap: 6 }}>
                <strong style={{ color: "var(--danger)", fontSize: 16 }}>El código no existe en el sistema.</strong>
                <span>No coincide con un material, categoría y tipo/modelo registrados (o los últimos 4 dígitos no son 9999).</span>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="confirmBackdrop" role="alertdialog" aria-modal="true" aria-label="Confirmar eliminación">
          <div className="confirmDialog">
            <h3>Eliminar segmento</h3>
            <p>
              ¿Seguro que deseas eliminar <strong>{confirmDelete.code} · {confirmDelete.label}</strong>? Esta acción no se puede deshacer.
            </p>
            <div className="confirmDialogActions">
              <button className="button" onClick={() => setConfirmDelete(null)} type="button">Cancelar</button>
              <button
                className="button buttonDanger"
                onClick={async () => {
                  const id = confirmDelete.id;
                  setConfirmDelete(null);
                  await remove(id);
                }}
                type="button"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import type { InventoryItem } from "@/types/inventory";
import type { ProductType } from "@/lib/product-types-api";
import { RawMaterialsManager } from "@/components/mantenimiento/raw-materials-manager";
import { SuppliesManager } from "@/components/mantenimiento/supplies-manager";
import { WasteManager } from "@/components/mantenimiento/waste-manager";
import { ComplementsManager } from "@/components/mantenimiento/complements-manager";
import { ProductTypesManager } from "@/components/mantenimiento/product-types-manager";

export type CreateItemResult =
  | { kind: "item"; item: InventoryItem }
  | { kind: "productType"; productType: ProductType };

export type CreateItemTab = "RAW_MATERIAL" | "SUPPLY" | "WASTE" | "COMPLEMENT" | "PRODUCT_TYPE";
type Tab = CreateItemTab;

const TAB_LABEL: Record<Tab, string> = {
  RAW_MATERIAL: "Materia prima",
  SUPPLY: "Insumo",
  WASTE: "Desperdicios",
  COMPLEMENT: "Complemento",
  PRODUCT_TYPE: "Producto terminado",
};

// Crear cualquier item de inventario sin salir del flujo (Rodrigo,
// 2026-08-20: "a la hora de seleccionar producto final en crear la orden
// debe haber la opcion para crear en el mantenimiento... debe permitir
// elegir si crear una materia prima, insumo, merma, complemento o producto
// terminado. Ventana con varias pestañas y listo"). Cada pestaña ES el
// mantenimiento de siempre (mismo componente, mismo endpoint) en modo
// crear -- sin logica nueva, solo un selector de cual mostrar.
export function CreateItemTabs({
  initialTab = "COMPLEMENT",
  onClose,
  onCreated,
}: {
  initialTab?: Tab;
  onClose: () => void;
  onCreated: (result: CreateItemResult) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  const tabsBar = (
    <div className="materialRow" style={{ gap: 6, flexWrap: "wrap" }}>
      {(Object.keys(TAB_LABEL) as Tab[]).map((key) => (
        <button
          className={`button${tab === key ? " buttonPrimary" : ""}`}
          key={key}
          onClick={() => setTab(key)}
          type="button"
        >
          {TAB_LABEL[key]}
        </button>
      ))}
    </div>
  );

  switch (tab) {
    case "RAW_MATERIAL":
      return (
        <RawMaterialsManager
          mode="create"
          onClose={onClose}
          onCreated={(item) => onCreated({ kind: "item", item })}
          tabs={tabsBar}
        />
      );
    case "SUPPLY":
      return (
        <SuppliesManager
          mode="create"
          onClose={onClose}
          onCreated={(item) => onCreated({ kind: "item", item })}
          tabs={tabsBar}
        />
      );
    case "WASTE":
      return (
        <WasteManager
          mode="create"
          onClose={onClose}
          onCreated={(item) => onCreated({ kind: "item", item })}
          tabs={tabsBar}
        />
      );
    case "COMPLEMENT":
      return (
        <ComplementsManager
          mode="create"
          onClose={onClose}
          onCreated={(item) => onCreated({ kind: "item", item })}
          tabs={tabsBar}
        />
      );
    case "PRODUCT_TYPE":
      return (
        <ProductTypesManager
          mode="create"
          onClose={onClose}
          onProductCreated={(productType) => onCreated({ kind: "productType", productType })}
          tabs={tabsBar}
        />
      );
  }
}

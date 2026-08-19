"use client";

import { useEffect, useState } from "react";
import { getCurrentUser } from "@/lib/auth-api";
import { normalizeRole, type Role } from "@/lib/roles";
import { ReportesDashboard } from "@/components/reportes/reportes-dashboard";
import { InventoryReports } from "@/components/reportes/inventory-reports";

export function ReportesView() {
  const [role, setRole] = useState<Role | null>(null);

  useEffect(() => {
    getCurrentUser()
      .then((user) => setRole(normalizeRole(user.role)))
      .catch(() => setRole("unknown"));
  }, []);

  if (role === null) {
    return (
      <div className="content">
        <div className="emptyState">Cargando reportes...</div>
      </div>
    );
  }

  // Admin y el rol fusionado Produccion/Inventario ven los dos reportes.
  return (
    <>
      <ReportesDashboard />
      <InventoryReports />
    </>
  );
}

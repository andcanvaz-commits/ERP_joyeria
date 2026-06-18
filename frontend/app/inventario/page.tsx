import { InventoryDashboard } from "@/components/inventory/inventory-dashboard";
import { AppShell } from "@/components/layout/app-shell";

export default function InventoryPage() {
  return (
    <AppShell>
      <InventoryDashboard />
    </AppShell>
  );
}

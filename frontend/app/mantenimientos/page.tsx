import { AppShell } from "@/components/layout/app-shell";
import { ProductionDashboard } from "@/components/production/production-dashboard";

export default function MaintenancePage() {
  return (
    <AppShell>
      <ProductionDashboard variant="maintenance" />
    </AppShell>
  );
}

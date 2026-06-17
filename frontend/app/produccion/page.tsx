import { AppShell } from "@/components/layout/app-shell";
import { ProductionDashboard } from "@/components/production/production-dashboard";

export default function ProductionPage() {
  return (
    <AppShell>
      <ProductionDashboard />
    </AppShell>
  );
}

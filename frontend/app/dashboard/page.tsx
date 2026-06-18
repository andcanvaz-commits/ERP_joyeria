import { SystemDashboard } from "@/components/dashboard/system-dashboard";
import { AppShell } from "@/components/layout/app-shell";

export default function DashboardPage() {
  return (
    <AppShell>
      <SystemDashboard />
    </AppShell>
  );
}

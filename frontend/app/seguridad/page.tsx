import { AppShell } from "@/components/layout/app-shell";
import { ChangePasswordForm } from "@/components/seguridad/change-password-form";

export default function SecurityPage() {
  return (
    <AppShell>
      <div className="content">
        <ChangePasswordForm />
      </div>
    </AppShell>
  );
}

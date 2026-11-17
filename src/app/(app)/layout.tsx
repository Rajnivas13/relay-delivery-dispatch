import { redirect } from "next/navigation";
import { requireUser } from "@/auth/session";
import { AppProvider } from "@/components/session-context";
import { Sidebar } from "@/components/sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.role === "RIDER") redirect("/rider");
  return (
    <AppProvider user={user}>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 lg:px-10">{children}</main>
      </div>
    </AppProvider>
  );
}

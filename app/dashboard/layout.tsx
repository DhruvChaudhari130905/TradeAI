import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  // Double-check auth (middleware should catch this, but defense in depth)
  if (!user) {
    redirect("/auth/login");
  }

  // Fetch profile for username
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.sub)
    .single();

  return (
    <AppShell username={profile?.username ?? null} email={user.email ?? null}>
      {children}
    </AppShell>
  );
}

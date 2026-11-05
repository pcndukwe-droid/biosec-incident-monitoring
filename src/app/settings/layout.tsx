import { currentUser } from "../../lib/server/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");
  return <>{children}</>;
}

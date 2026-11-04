import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Biosec | Incident Monitoring",
  description: "Biosec infrastructure and API health monitoring platform",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

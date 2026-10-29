import type { Metadata, Viewport } from "next";
import { Onest } from "next/font/google";
import { Header } from "@/components/header";
import { getCurrentUser } from "@/lib/session";
import { BRAND } from "@/lib/brand";
import "./globals.css";

const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: { default: `${BRAND.name} — ${BRAND.tagline}`, template: `%s · ${BRAND.name}` },
  description: "Платформа безопасных сделок: договор с ЭЦП, деньги на эскроу-счёте, выплата мастеру по этапам.",
  appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#1f5145",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  return (
    <html lang="ru" className={`${onest.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <Header user={user} />
        <main className="flex-1">{children}</main>
        <footer className="no-print border-t border-line py-6 text-center text-xs text-muted">
          {BRAND.name} · демо-версия · ЭЦП и банковские операции имитируются · участник Astana Hub
        </footer>
      </body>
    </html>
  );
}

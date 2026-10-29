import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} — ${BRAND.tagline}`,
    short_name: BRAND.name,
    description: "Договор с ЭЦП, деньги на эскроу-счёте, выплата мастеру по этапам.",
    start_url: "/deals",
    display: "standalone",
    background_color: "#f6f3ee",
    theme_color: "#1f5145",
    lang: "ru",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}

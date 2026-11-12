import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { CONSENT_DOCUMENTS } from "@/i18n/ru/consent";
import { Alert } from "@/ui";
import { ConsentText } from "./ConsentText";

describe("ConsentText", () => {
  it.each(["PD_PROCESSING", "BANK_TRANSFER"] as const)("%s: первая строка — отметка черновика, затем редакция и разделы по порядку", (kind) => {
    const doc = CONSENT_DOCUMENTS[kind];
    const root = ConsentText({ document: doc }) as ReactElement<{ children: ReactNode[] }>;
    const [first, edition, sections] = root.props.children as [ReactElement<{ children: string }>, ReactElement<{ children: string }>, ReactElement<{ children: ReactNode[] }>[]];
    expect(first.type).toBe(Alert);
    expect(first.props.children).toBe("Черновик, требует юридической проверки");
    expect(edition.props.children).toContain(doc.version);
    expect(sections.map((s) => (s.props.children[0] as ReactElement<{ children: string }>).props.children)).toEqual(doc.sections.map((s) => s.heading));
  });
});

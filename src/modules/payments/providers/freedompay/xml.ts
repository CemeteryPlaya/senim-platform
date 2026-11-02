import type { FieldValue, Fields } from "./signature";

/**
 * Минимальный разбор XML ответов Freedom Pay: «The response body is XML (`Content-Type: text/xml`)
 * with the root element `<response>`» (Merchant API Overview). Элементы без атрибутов и смешанного
 * содержимого: лист → строка, элемент с детьми → вложенные поля в порядке документа (для подписи).
 * Не поддерживаются DTD и внешние сущности — их в ответах нет, и разбирать их небезопасно.
 */

export type XmlDoc = { root: string; fields: Fields };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string | null {
  let bad = false;
  const out = text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);|&/gi, (whole, ref: string | undefined) => {
    if (!ref) return ((bad = true), whole);
    if (ref[0] !== "#") return ENTITIES[ref] ?? ((bad = true), whole);
    const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : ((bad = true), whole);
  });
  return bad ? null : out;
}

type Element = { name: string; value: FieldValue };

class Parser {
  pos = 0;
  constructor(private readonly s: string) {}

  skipMisc() {
    for (;;) {
      const rest = this.s.slice(this.pos);
      const ws = /^\s+/.exec(rest);
      if (ws) this.pos += ws[0].length;
      else if (rest.startsWith("<?")) this.skipTo("?>");
      else if (rest.startsWith("<!--")) this.skipTo("-->");
      else return;
    }
  }

  skipTo(end: string) {
    const at = this.s.indexOf(end, this.pos);
    this.pos = at < 0 ? this.s.length + 1 : at + end.length;
  }

  /** Элемент в текущей позиции или null, если это не корректный элемент. */
  element(): Element | null {
    const open = /^<([A-Za-z_][\w.-]*)(?:\s+[^<>]*?)?(\/?)>/.exec(this.s.slice(this.pos));
    if (!open) return null;
    this.pos += open[0].length;
    const name = open[1]!;
    return open[2] === "/" ? { name, value: "" } : this.body(name);
  }

  /** Содержимое до `</name>`: текст (лист) или дочерние элементы; смешанное содержимое — null. */
  body(name: string): Element | null {
    const children: Array<[string, FieldValue]> = [];
    let text = "";
    while (this.pos < this.s.length) {
      if (this.s.startsWith(`</${name}>`, this.pos)) {
        this.pos += name.length + 3;
        if (children.length === 0) return { name, value: text };
        return text.trim() === "" ? { name, value: children } : null;
      }
      const part = this.part();
      if (part === null) return null;
      if (typeof part === "string") text += part;
      else children.push([part.name, part.value]);
    }
    return null;
  }

  /** Одна часть содержимого: текст, CDATA, комментарий (пустая строка) или элемент. */
  part(): string | Element | null {
    if (this.s.startsWith("<![CDATA[", this.pos)) {
      const end = this.s.indexOf("]]>", this.pos);
      if (end < 0) return null;
      const text = this.s.slice(this.pos + 9, end);
      this.pos = end + 3;
      return text;
    }
    if (this.s.startsWith("<!--", this.pos)) {
      this.skipTo("-->");
      return "";
    }
    if (this.s.startsWith("<", this.pos)) return this.element();
    const next = this.s.indexOf("<", this.pos);
    const end = next < 0 ? this.s.length : next;
    const text = decode(this.s.slice(this.pos, end));
    this.pos = end;
    return text;
  }
}

/** XML-документ → корень и поля; не XML, DTD или мусор после корня — null. */
export function parseXmlFields(text: string): XmlDoc | null {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return null;
  const parser = new Parser(text);
  parser.skipMisc();
  const root = parser.element();
  if (!root) return null;
  parser.skipMisc();
  if (parser.pos !== text.length) return null;
  return { root: root.name, fields: typeof root.value === "string" ? [] : root.value };
}

/** Строковое значение поля верхнего уровня (первое с таким именем). */
export function fieldText(fields: Fields, name: string): string | undefined {
  const value = fields.find(([key]) => key === name)?.[1];
  return typeof value === "string" ? value : undefined;
}

/** Вложенные поля верхнего уровня (первое с таким именем). */
export function fieldGroup(fields: Fields, name: string): Fields | undefined {
  const value = fields.find(([key]) => key === name)?.[1];
  return typeof value === "string" ? undefined : value;
}

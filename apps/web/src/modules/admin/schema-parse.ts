// Разбор prisma/schema.prisma для админки: рантайм Prisma 7 не несёт обязательность, списки, @id и @default, а
// @prisma/internals в зависимостях нет. Чистая функция: её вызывает генератор scripts/admin-schema.ts, а тест
// schema-sync сверяет результат с закоммиченным schema.gen.ts. Непонятная строка поля — ошибка, а не пропуск:
// поле без метаданных не получило бы правила доступа.

export type AdminField = {
  name: string;
  kind: "scalar" | "enum" | "object";
  type: string;
  required: boolean;
  list: boolean;
  id: boolean;
  updatedAt: boolean;
  hasDefault: boolean;
  /** У поля-связи — скалярные поля из `@relation(fields: [...])`; у остальных — пусто. */
  relationFields: readonly string[];
};

export type AdminModel = {
  name: string;
  fields: readonly AdminField[];
  /** Единственное поле с `@id`; составной ключ или его отсутствие — null (у такой модели нет карточки и правки). */
  idField: string | null;
};

const SCALARS: ReadonlySet<string> = new Set(["String", "Boolean", "Int", "BigInt", "Float", "Decimal", "DateTime", "Json", "Bytes"]);

type Block = { kind: "model" | "enum"; name: string; lines: string[] };

/** Строка без комментария `//` (и `///`); `//` внутри строки в кавычках — не комментарий. */
function stripComment(line: string): string {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && quoted) i++;
    else if (c === '"') quoted = !quoted;
    else if (c === "/" && !quoted && line[i + 1] === "/") return line.slice(0, i);
  }
  return line;
}

function blocks(source: string): Block[] {
  const out: Block[] = [];
  let current: Block | null = null;
  let skipping = false;
  for (const raw of source.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line) continue;
    if (current || skipping) {
      if (line === "}") {
        if (current) out.push(current);
        current = null;
        skipping = false;
      } else if (current) current.lines.push(line);
      continue;
    }
    const start = /^(\w+)\s+(\w+)\s*\{$/.exec(line);
    if (!start) continue;
    if (start[1] === "model" || start[1] === "enum") current = { kind: start[1], name: start[2], lines: [] };
    else skipping = true; // generator, datasource и прочие блоки — не данные
  }
  return out;
}

const hasAttr = (attrs: string, name: string) => new RegExp(`(^|\\s)@${name}(?![\\w.])`).test(attrs);

function parseField(model: string, line: string, enums: ReadonlySet<string>, models: ReadonlySet<string>): AdminField {
  const m = /^(\w+)\s+(\w+)(\[\])?(\?)?(?:\s+(.*))?$/.exec(line);
  if (!m) throw new Error(`schema.prisma: не разобрано поле модели ${model}: «${line}»`);
  const [, name, type, list, optional, attrs = ""] = m;
  const kind = SCALARS.has(type) ? "scalar" : enums.has(type) ? "enum" : models.has(type) ? "object" : null;
  if (!kind) throw new Error(`schema.prisma: неизвестный тип ${type} поля ${model}.${name}`);
  const relation = /@relation\([^)]*\bfields:\s*\[([^\]]*)\]/.exec(attrs);
  return {
    name,
    kind,
    type,
    required: !optional,
    list: Boolean(list),
    id: hasAttr(attrs, "id"),
    updatedAt: hasAttr(attrs, "updatedAt"),
    hasDefault: /(^|\s)@default\(/.test(attrs),
    relationFields: relation ? relation[1].split(",").map((s) => s.trim()).filter(Boolean) : [],
  };
}

/** Модели схемы в порядке объявления: поля, их признаки и поле-ключ. */
export function parseSchema(source: string): AdminModel[] {
  const all = blocks(source);
  const enums = new Set(all.filter((b) => b.kind === "enum").map((b) => b.name));
  const models = new Set(all.filter((b) => b.kind === "model").map((b) => b.name));
  return all
    .filter((b) => b.kind === "model")
    .map((b) => {
      const fields = b.lines.filter((l) => !l.startsWith("@@")).map((l) => parseField(b.name, l, enums, models));
      const ids = fields.filter((f) => f.id);
      return { name: b.name, fields, idField: ids.length === 1 ? ids[0].name : null };
    });
}

/** Перечисления схемы: имя → значения в порядке объявления. */
export function parseEnums(source: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const b of blocks(source)) {
    if (b.kind !== "enum") continue;
    out[b.name] = b.lines.filter((l) => !l.startsWith("@@")).map((l) => {
      const v = /^(\w+)/.exec(l);
      if (!v) throw new Error(`schema.prisma: не разобрано значение перечисления ${b.name}: «${l}»`);
      return v[1];
    });
  }
  return out;
}

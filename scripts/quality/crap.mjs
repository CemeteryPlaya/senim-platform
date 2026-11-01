// CRAP-отчёт: эквивалент инструмента `crapper` из SKILL.md.
//
// CRAP(f) = comp² × (1 − cov)³ + comp
//   comp — цикломатическая сложность функции (по AST TypeScript),
//   cov  — доля покрытых операторов функции (istanbul JSON из @vitest/coverage-v8).
//
// Запуск: npm run quality:crap [-- --check] [--reuse] [--threshold 10] [--only src/modules/payments]
//   --reuse      не гонять тесты, взять готовый reports/quality/coverage/coverage-final.json
//   --check      код выхода 1, если есть функции с CRAP ≥ порога
//   --only P     показать только файлы, путь которых начинается с P (можно несколько раз)
// Покрытие собирается полным прогоном vitest (unit + integration): нужен TEST_DATABASE_URL.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const reportDir = path.join(root, "reports", "quality");
const coverageDir = path.join(reportDir, "coverage");
const coverageFile = path.join(coverageDir, "coverage-final.json");

/** Что не анализируем: сгенерированный клиент, тесты, тексты, типы. */
const EXCLUDE = [/^src\/generated\//, /\.test\.tsx?$/, /\.d\.ts$/, /^src\/i18n\//];

function parseArgs(argv) {
  const args = { check: false, reuse: false, threshold: 10, only: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") args.check = true;
    else if (a === "--reuse") args.reuse = true;
    else if (a === "--threshold") args.threshold = Number(argv[++i]);
    else if (a === "--only") args.only.push(argv[++i].replace(/\\/g, "/"));
    else throw new Error(`Неизвестный аргумент: ${a}`);
  }
  return args;
}

function runCoverage() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("Нужен TEST_DATABASE_URL: покрытие собирается полным прогоном (unit + integration)");
  }
  fs.rmSync(coverageDir, { recursive: true, force: true });
  const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
  const res = spawnSync(
    process.execPath,
    [
      vitest,
      "run",
      "--coverage.enabled",
      "--coverage.provider=v8",
      "--coverage.reporter=json",
      `--coverage.reportsDirectory=${coverageDir}`,
      "--coverage.include=src/**/*.{ts,tsx}",
      "--coverage.exclude=src/generated/**",
      "--coverage.reportOnFailure",
    ],
    { stdio: "inherit" },
  );
  if (!fs.existsSync(coverageFile)) throw new Error("Покрытие не собрано: нет coverage-final.json");
  if (res.status !== 0) process.stdout.write("\nВнимание: часть тестов упала — покрытие может быть занижено.\n\n");
}

function listSources(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const rel = path.relative(root, path.join(entry.parentPath, entry.name)).replace(/\\/g, "/");
    if (!EXCLUDE.some((re) => re.test(rel))) out.push(rel);
  }
  return out.sort();
}

const normKey = (p) => path.resolve(p).replace(/\\/g, "/").toLowerCase();

function loadCoverage() {
  const raw = JSON.parse(fs.readFileSync(coverageFile, "utf8"));
  const map = new Map();
  for (const [file, data] of Object.entries(raw)) map.set(normKey(file), data);
  return map;
}

const isFunctionLike = (n) =>
  (ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n) ||
    ts.isConstructorDeclaration(n)) &&
  n.body !== undefined;

const LOGICAL = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** Точки ветвления, как у правила ESLint `complexity` (без `?.` и параметров по умолчанию). */
function decisionPoints(node) {
  switch (node.kind) {
    case ts.SyntaxKind.IfStatement:
    case ts.SyntaxKind.ConditionalExpression:
    case ts.SyntaxKind.ForStatement:
    case ts.SyntaxKind.ForInStatement:
    case ts.SyntaxKind.ForOfStatement:
    case ts.SyntaxKind.WhileStatement:
    case ts.SyntaxKind.DoStatement:
    case ts.SyntaxKind.CatchClause:
    case ts.SyntaxKind.CaseClause:
      return 1;
    case ts.SyntaxKind.BinaryExpression:
      return LOGICAL.has(node.operatorToken.kind) ? 1 : 0;
    default:
      return 0;
  }
}

function functionName(fn, sf) {
  if (fn.name) return fn.name.getText(sf);
  if (ts.isConstructorDeclaration(fn)) return "constructor";
  const p = fn.parent;
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) return p.name.getText(sf);
  if (ts.isExportAssignment(p)) return "default";
  if (ts.isCallExpression(p)) {
    const callee = p.expression.getText(sf);
    return `${callee.length > 30 ? callee.slice(0, 30) + "…" : callee}(…) callback`;
  }
  if (ts.isJsxExpression(p)) return "<jsx callback>";
  return "<anonymous>";
}

/** Все функции файла: сложность без вложенных функций и диапазоны для покрытия. */
function analyzeFile(rel) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  const kind = rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  const fns = [];

  function visitFn(fn) {
    const info = { node: fn, complexity: 1, nested: [] };
    fns.push(info);
    const walk = (n) => {
      if (isFunctionLike(n)) {
        info.nested.push([n.getStart(sf), n.end]);
        visitFn(n);
        return;
      }
      info.complexity += decisionPoints(n);
      ts.forEachChild(n, walk);
    };
    ts.forEachChild(fn.body, walk);
  }

  const top = (n) => (isFunctionLike(n) ? visitFn(n) : ts.forEachChild(n, top));
  top(sf);

  return fns.map((f) => {
    const start = f.node.getStart(sf);
    const lc = sf.getLineAndCharacterOfPosition(start);
    return {
      name: functionName(f.node, sf),
      line: lc.line + 1,
      complexity: f.complexity,
      bodyRange: [f.node.body.getStart(sf), f.node.body.end],
      nested: f.nested,
      sf,
    };
  });
}

function toOffset(sf, loc) {
  const lines = sf.getLineStarts();
  const lineStart = lines[Math.min(loc.line - 1, lines.length - 1)];
  return lineStart + (loc.column ?? 0);
}

/** Доля покрытых операторов внутри тела функции (без вложенных функций). */
function functionCoverage(fn, cov) {
  if (!cov) return 0;
  let total = 0;
  let hit = 0;
  for (const [id, loc] of Object.entries(cov.statementMap)) {
    const off = toOffset(fn.sf, loc.start);
    if (off < fn.bodyRange[0] || off >= fn.bodyRange[1]) continue;
    if (fn.nested.some(([s, e]) => off >= s && off < e)) continue;
    total++;
    if (cov.s[id] > 0) hit++;
  }
  if (total > 0) return hit / total;
  // Тело без операторов (например, `() => x` без отдельного оператора): берём факт вызова.
  for (const [id, f] of Object.entries(cov.fnMap)) {
    const off = toOffset(fn.sf, f.loc.start);
    if (off <= fn.bodyRange[0] && off >= fn.bodyRange[0] - 400 && f.loc.start.line === fn.line) return cov.f[id] > 0 ? 1 : 0;
  }
  return 0;
}

const crap = (c, cov) => c * c * Math.pow(1 - cov, 3) + c;

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.reuse) runCoverage();
  const coverage = loadCoverage();
  const files = listSources(path.join(root, "src")).filter(
    (f) => args.only.length === 0 || args.only.some((p) => f.startsWith(p)),
  );

  const all = [];
  for (const rel of files) {
    const cov = coverage.get(normKey(rel));
    for (const fn of analyzeFile(rel)) {
      const c = functionCoverage(fn, cov);
      all.push({
        file: rel,
        line: fn.line,
        name: fn.name,
        complexity: fn.complexity,
        coverage: Math.round(c * 1000) / 10,
        crap: Math.round(crap(fn.complexity, c) * 10) / 10,
      });
    }
  }
  const over = all.filter((f) => f.crap >= args.threshold).sort((a, b) => b.crap - a.crap);

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportDir, "crap.json"),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), threshold: args.threshold, files: files.length, functions: all.length, overThreshold: over.length, over },
      null,
      2,
    ),
  );

  const out = [];
  out.push(`CRAP ≥ ${args.threshold}: ${over.length} из ${all.length} функций (${files.length} файлов)\n`);
  if (over.length > 0) {
    out.push(`${pad("CRAP", 8)}${pad("сложн.", 8)}${pad("покр.%", 8)}функция\n`);
    for (const f of over) out.push(`${pad(f.crap, 8)}${pad(f.complexity, 8)}${pad(f.coverage, 8)}${f.file}:${f.line} ${f.name}\n`);
  }
  out.push(`\nОтчёт: ${path.relative(root, path.join(reportDir, "crap.json"))}\n`);
  process.stdout.write(out.join(""));
  if (args.check && over.length > 0) process.exitCode = 1;
}

main();

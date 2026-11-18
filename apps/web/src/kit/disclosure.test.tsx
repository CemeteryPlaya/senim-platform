import { describe, expect, it } from "vitest";
import { Disclosure, DisclosureList } from "./index";
import { count, hasClass, html, text } from "./test-utils";

describe("Disclosure", () => {
  const out = html(<Disclosure title="Как считаются статусы">Ответ про статусы</Disclosure>);

  it("нативный details: закрыт по умолчанию, summary — первая цель, содержимое в разметке", () => {
    expect(out).toContain("<details");
    expect(out).not.toMatch(/<details[^>]*\sopen/);
    expect(out).toMatch(/<summary[^>]*>.*Как считаются статусы/s);
    expect(out.indexOf("<summary")).toBeLessThan(out.indexOf("Ответ про статусы"));
    expect(text(<Disclosure title="Q">Ответ</Disclosure>)).toContain("Ответ");
  });

  it("summary не ниже 48 px, шеврон скрыт от диктора и не вращается при reduced-motion", () => {
    expect(hasClass(out, "min-h-control")).toBe(true);
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(out).toContain("motion-reduce:transition-none");
  });

  it("open — раскрыт сразу", () => {
    expect(html(<Disclosure title="Q" open>A</Disclosure>)).toMatch(/<details[^>]*\sopen/);
  });
});

describe("DisclosureList", () => {
  it("группа с именем для диктора; вопросы — отдельные details", () => {
    const list = html(
      <DisclosureList label="Вопросы и ответы">
        <Disclosure title="Один">A</Disclosure>
        <Disclosure title="Два">B</Disclosure>
      </DisclosureList>,
    );
    expect(list).toContain('role="group"');
    expect(list).toContain('aria-label="Вопросы и ответы"');
    expect(count(list, "<details")).toBe(2);
    expect(count(list, "<summary")).toBe(2);
  });
});

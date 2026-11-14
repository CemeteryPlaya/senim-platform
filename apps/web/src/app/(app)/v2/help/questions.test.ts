import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { dealHelpItems } from "../deals/_parts/help-items";
import { HELP_ANCHORS, MASTER_HELP_ANCHORS } from "./anchors";
import { helpItem, masterHelpItem } from "./questions";

const h = ru.app.profile.help;

describe("вопросы блоков помощи — дословно заголовки разделов «Помощи»", () => {
  it("экраны сделок: «Где мои деньги?» и «Что, если мебель не подошла?» — со ссылками на разделы", () => {
    expect(dealHelpItems()).toEqual([
      { question: "Где мои деньги?", href: "/v2/help#money" },
      { question: h.notFit.title, href: "/v2/help#not-fit" },
    ]);
  });

  it("экраны сделок мастера: вопросы — заголовки разделов «Помощи» мастера, ссылки на те же якоря", () => {
    const m = ru.app.masterProfile.help;
    expect(dealHelpItems("EXECUTOR")).toEqual([
      { question: m.money.title, href: "/v2/help#money" },
      { question: m.dispute.title, href: "/v2/help#dispute" },
    ]);
    expect(masterHelpItem(MASTER_HELP_ANCHORS.requests)).toEqual({ question: m.requests.title, href: "/v2/help#requests" });
  });

  it("каждый якорь — заголовок своего раздела", () => {
    expect(helpItem(HELP_ANCHORS.how)).toEqual({ question: h.how.title, href: "/v2/help#how" });
    expect(helpItem(HELP_ANCHORS.price).question).toBe(h.price.title);
    expect(helpItem(HELP_ANCHORS.money).question).toBe(h.money.title);
  });
});

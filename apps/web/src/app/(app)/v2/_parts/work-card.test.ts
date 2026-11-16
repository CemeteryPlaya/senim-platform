import { describe, expect, it } from "vitest";
import type { PortfolioCard } from "@/modules/companies";
import { workCardView, workGallery } from "./work-card";

const card = (photos: PortfolioCard["photos"]): PortfolioCard => ({
  id: "w1",
  title: "Кухня",
  description: "",
  furnitureType: { slug: "kitchen", name: "Кухня" },
  style: { key: "modern", name: "Современный" },
  priceFrom: 900_000,
  place: "Астана",
  featured: false,
  doneOnPlatform: false,
  reviewId: null,
  photos,
  executor: { id: "e1", publicNumber: 1, label: "Исполнитель №1", segment: "COMFORT", ratingAvg: 0, reviewsCount: 0 },
});

describe("карточка работы: уменьшенная копия фото", () => {
  it("обложка карточки — превью (thumb), галерея на весь экран — исходник", () => {
    const view = card([{ id: "f1", src: "/api/files/full.jpg", thumb: "/api/files/full.preview.jpg", alt: "Кухня, фото 1" }]);
    expect(workCardView(view).photo).toEqual({ src: "/api/files/full.preview.jpg", alt: "Кухня, фото 1" });
    expect(workGallery([view])[0]?.src).toBe("/api/files/full.jpg");
  });

  it("превью нет (старый файл) — обложка из исходника", () => {
    expect(workCardView(card([{ id: "f1", src: "/api/files/old.jpg", alt: "Кухня, фото 1" }])).photo?.src).toBe("/api/files/old.jpg");
  });
});

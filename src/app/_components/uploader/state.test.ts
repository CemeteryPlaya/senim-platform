import { describe, expect, it } from "vitest";
import { doneFileIds, initialState, isUploading, toPhotoItems, uploaderReducer as reduce, type UploaderState } from "./state";

const add = (s: UploaderState, ...ids: string[]) => reduce(s, { type: "added", items: ids.map((localId) => ({ localId, src: `blob:${localId}` })) });

describe("состояние загрузчика", () => {
  it("начинает с сохранённых файлов: они уже готовы", () => {
    const s = initialState([{ id: "f1", url: "/a.jpg" }]);
    expect(toPhotoItems(s)).toEqual([{ id: "f1", src: "/a.jpg", status: "done" }]);
    expect(doneFileIds(s)).toEqual(["f1"]);
  });

  it("новое фото: загрузка с прогрессом → готово с id файла", () => {
    let s = add(initialState([]), "l1");
    expect(toPhotoItems(s)).toEqual([{ id: "l1", src: "blob:l1", status: "uploading", progress: 0 }]);
    s = reduce(s, { type: "progress", localId: "l1", progress: 40 });
    expect(toPhotoItems(s)[0]).toMatchObject({ status: "uploading", progress: 40 });
    expect(doneFileIds(s)).toEqual([]);
    s = reduce(s, { type: "done", localId: "l1", fileId: "f9", url: "/f9.jpg" });
    expect(toPhotoItems(s)[0]).toEqual({ id: "l1", src: "blob:l1", status: "done" });
    expect(doneFileIds(s)).toEqual(["f9"]);
  });

  it("«идёт загрузка», пока хоть одно фото не готово; ошибка загрузку не держит", () => {
    let s = add(initialState([{ id: "f1", url: "/a.jpg" }]), "l1", "l2");
    expect(isUploading(s)).toBe(true);
    s = reduce(s, { type: "done", localId: "l1", fileId: "f2", url: "/f2.jpg" });
    expect(isUploading(s)).toBe(true);
    s = reduce(s, { type: "failed", localId: "l2", error: "Сбой сети" });
    expect(isUploading(s)).toBe(false);
    s = reduce(s, { type: "retrying", localId: "l2" });
    expect(isUploading(s)).toBe(true);
  });

  it("ошибка показывается у фото, повтор снова запускает загрузку", () => {
    let s = reduce(add(initialState([]), "l1"), { type: "failed", localId: "l1", error: "Это не фото" });
    expect(toPhotoItems(s)[0]).toMatchObject({ status: "error", error: "Это не фото" });
    s = reduce(s, { type: "retrying", localId: "l1" });
    expect(toPhotoItems(s)[0]).toMatchObject({ status: "uploading", progress: 0 });
  });

  it("порядок id файлов — порядок фото на экране; удалённое пропадает", () => {
    let s = add(initialState([{ id: "f0", url: "/0.jpg" }]), "l1", "l2");
    s = reduce(s, { type: "done", localId: "l2", fileId: "f2", url: "/2.jpg" });
    s = reduce(s, { type: "done", localId: "l1", fileId: "f1", url: "/1.jpg" });
    expect(doneFileIds(s)).toEqual(["f0", "f1", "f2"]);
    s = reduce(s, { type: "removed", localId: "l1" });
    expect(doneFileIds(s)).toEqual(["f0", "f2"]);
    expect(toPhotoItems(s).map((p) => p.id)).toEqual(["f0", "l2"]);
  });

  it("событие для уже удалённого фото ничего не ломает", () => {
    const s = reduce(reduce(add(initialState([]), "l1"), { type: "removed", localId: "l1" }), { type: "done", localId: "l1", fileId: "f1", url: "/1.jpg" });
    expect(doneFileIds(s)).toEqual([]);
  });
});

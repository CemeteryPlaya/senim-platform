import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Role as ProtoRole, UserSchema, type User } from "@/gen/senim/identity/v1/identity_pb";
import { db } from "@/platform/db";
import { AppError } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { projectUser } from "./projection";

afterEach(() => vi.restoreAllMocks());

function identityUser(over: Partial<{ id: string; phone: string; defaultRole: ProtoRole; roles: ProtoRole[]; isDemo: boolean; blockedAt: Date }> = {}): User {
  const { blockedAt, ...rest } = over;
  return create(UserSchema, {
    id: "u-77001234567",
    phone: "+77001234567",
    defaultRole: ProtoRole.CLIENT,
    roles: [ProtoRole.CLIENT],
    ...rest,
    blockedAt: blockedAt ? timestampFromDate(blockedAt) : undefined,
  });
}

describe("projectUser", () => {
  it("создаёт строку User с тем же id", async () => {
    await projectUser(identityUser({ isDemo: true }));

    expect(await db.user.findUniqueOrThrow({ where: { id: "u-77001234567" } })).toMatchObject({
      phone: "+77001234567",
      role: "CLIENT",
      roles: ["CLIENT"],
      isDemo: true,
      blockedAt: null,
    });
  });

  it("обновляет роли и роль по умолчанию, не трогая поля старой базы", async () => {
    await projectUser(identityUser());
    await db.user.update({ where: { id: "u-77001234567" }, data: { fullName: "Айдос Серик", iinLast4: "1234" } });

    await projectUser(identityUser({ defaultRole: ProtoRole.EXECUTOR, roles: [ProtoRole.CLIENT, ProtoRole.EXECUTOR] }));

    expect(await db.user.findUniqueOrThrow({ where: { id: "u-77001234567" } })).toMatchObject({
      role: "EXECUTOR",
      roles: ["CLIENT", "EXECUTOR"],
      fullName: "Айдос Серик",
      iinLast4: "1234",
    });
  });

  it("повтор без изменений не пишет в базу", async () => {
    await projectUser(identityUser());
    const before = await db.user.findUniqueOrThrow({ where: { id: "u-77001234567" } });

    await projectUser(identityUser());

    expect((await db.user.findUniqueOrThrow({ where: { id: "u-77001234567" } })).updatedAt).toEqual(before.updatedAt);
  });

  it("переносит блокировку и снятие блокировки", async () => {
    const blockedAt = new Date("2026-11-10T08:00:00Z");
    await projectUser(identityUser());
    await projectUser(identityUser({ blockedAt }));
    expect((await db.user.findUniqueOrThrow({ where: { id: "u-77001234567" } })).blockedAt).toEqual(blockedAt);

    await projectUser(identityUser());
    expect((await db.user.findUniqueOrThrow({ where: { id: "u-77001234567" } })).blockedAt).toBeNull();
  });

  it("роль по умолчанию вне выданных ролей — ошибка, строка не создаётся", async () => {
    await expect(projectUser(identityUser({ defaultRole: ProtoRole.EXECUTOR, roles: [ProtoRole.CLIENT] }))).rejects.toThrow();
    expect(await db.user.count()).toBe(0);
  });

  it("параллельные вызовы для нового пользователя дают одну строку", async () => {
    await Promise.all(Array.from({ length: 5 }, () => projectUser(identityUser())));

    expect(await db.user.count()).toBe(1);
  });

  it("тот же телефон у другого id: CONFLICT, запись в лог без телефона, дубля нет", async () => {
    const legacy = await db.user.create({ data: { id: "legacy-cuid", phone: "+77001234567", role: "CLIENT", roles: ["CLIENT"] } });
    const log = vi.spyOn(logger, "error").mockImplementation(() => {});

    const err = await projectUser(identityUser()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("CONFLICT");
    expect(log).toHaveBeenCalledWith("identity.projection.phone_conflict", { userId: "u-77001234567" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("+7700");
    expect(await db.user.findMany({ select: { id: true } })).toEqual([{ id: legacy.id }]);
  });
});

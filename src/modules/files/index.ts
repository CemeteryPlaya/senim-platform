import "server-only";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { localStorageProvider } from "./providers/local";
import type { StorageProvider } from "./storage";

export type * from "./storage";

export function storage(): StorageProvider {
  switch (env().STORAGE_PROVIDER) {
    case "local":
      return localStorageProvider;
    case "s3":
    case "vercel-blob":
      return fail.unavailable("Хранилище ещё не подключено");
  }
}

export const jobHandlers = {} as const;

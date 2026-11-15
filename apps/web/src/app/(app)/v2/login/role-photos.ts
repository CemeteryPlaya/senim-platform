import "server-only";
import { standPhoto } from "@/platform/stand-photos";

/**
 * Фото плиток выбора роли при входе (статика стенда): покупателю — светлая кухня с островом, мастеру — мастерская без людей
 * в тёплом свете из окна. Только сервер: страница передаёт шагу готовые адреса.
 */
export type RolePhotos = { client: string; executor: string };

export function rolePhotos(): RolePhotos {
  return { client: standPhoto("kitchen-island-oak").src, executor: standPhoto("workshop-hall").src };
}

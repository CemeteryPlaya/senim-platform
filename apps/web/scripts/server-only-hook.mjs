// Скрипты вне Next (сид, фоновые задачи) используют серверные модули. Пакет server-only в обычном
// Node бросает ошибку (он рассчитан на сборку Next), а условие react-server ломает импорт next/navigation.
// Поэтому здесь server-only подменяется пустым модулем — так же, как в тестах (vitest alias).
import { registerHooks } from "node:module";

const EMPTY = new URL("./server-only-empty.cjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: EMPTY, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

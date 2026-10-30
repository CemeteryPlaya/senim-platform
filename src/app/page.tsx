import { ru } from "@/i18n/ru";

// Временная заглушка лендинга до фазы B.
export default function HomePage() {
  return (
    <main>
      <h1>{ru.common.brand}</h1>
      <p>{ru.common.tagline}</p>
    </main>
  );
}

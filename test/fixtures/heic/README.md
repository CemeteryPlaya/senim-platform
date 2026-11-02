# HEIC-образец для тестов

`rotated-exif-gps.heic` (724 байта) — настоящий HEIC: HEVC-кадр в контейнере HEIF, устроенный как фото с iPhone.

- Пиксели 128×96 «лёжа»: левая половина тёмная, правая светлая.
- Коробка `irot` — поворот на 90° по часовой; правильно раскрытое фото — портрет 96×128, тёмное сверху.
- Элемент `Exif`: `Orientation=6`, `Make=Phone`, `Model=Phone 15`, геолокация. Если бы поворот применялся и по `irot`, и по EXIF, получилось бы снова 128×96.

Источник: сгенерирован скриптом `make-heic.mts` в этой папке (картинку рисует sharp, HEVC кодирует ffmpeg/libx265, контейнер собирается по ISO/IEC 23008-12). Изображение создано для проекта, чужих прав нет; лицензия — как у репозитория.

Пересоздать (нужен ffmpeg с libx265 в PATH):

```bash
npx tsx test/fixtures/heic/make-heic.mts
```

Проверка образца независимым декодером: `ffmpeg -i rotated-exif-gps.heic out.png` даёт 96×128.

Используется в `src/modules/files/image.test.ts` и `src/modules/files/upload.int.test.ts`.

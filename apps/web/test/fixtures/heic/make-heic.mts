/**
 * Генератор test/fixtures/heic/rotated-exif-gps.heic — маленького настоящего HEIC (HEVC внутри HEIF),
 * устроенного как фото с iPhone: пиксели хранятся «лёжа», поворот задан коробкой irot,
 * рядом EXIF с Orientation=6, моделью телефона и геолокацией.
 *
 * Картинку рисуем сами (sharp), HEVC кодирует ffmpeg (libx265), контейнер HEIF собираем здесь
 * по ISO/IEC 23008-12 — поэтому у образца нет чужих прав. Нужен ffmpeg с libx265 в PATH:
 *   npx tsx test/fixtures/heic/make-heic.mts
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const OUT = path.join(import.meta.dirname, "rotated-exif-gps.heic");
/** Пиксели «лёжа»: слева тёмное, справа светлое. После поворота на 90° по часовой тёмное — сверху. */
const WIDTH = 128;
const HEIGHT = 96;

const u8 = (n: number) => Buffer.from([n]);
const u16 = (n: number) => Buffer.from([n >> 8, n & 0xff]);
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const box = (type: string, ...body: Buffer[]) => {
  const payload = Buffer.concat(body);
  return Buffer.concat([u32(payload.length + 8), Buffer.from(type, "ascii"), payload]);
};
const fullBox = (type: string, version: number, flags: number, ...body: Buffer[]) =>
  box(type, u8(version), Buffer.from([(flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]), ...body);

async function sourcePng(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <rect width="${WIDTH / 2}" height="${HEIGHT}" fill="#202020"/>
    <rect x="${WIDTH / 2}" width="${WIDTH / 2}" height="${HEIGHT}" fill="#e0e0e0"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** HEVC Annex B (00 00 01 …) → NAL-блоки без стартовых кодов. */
function splitAnnexB(stream: Buffer): Buffer[] {
  const starts: number[] = [];
  for (let i = 0; i + 3 <= stream.length; i++) {
    if (stream[i] === 0 && stream[i + 1] === 0 && stream[i + 2] === 1) {
      starts.push(i + 3);
      i += 2;
    }
  }
  return starts.map((start, k) => {
    let end = k + 1 < starts.length ? starts[k + 1]! - 3 : stream.length;
    while (end > start && stream[end - 1] === 0) end--; // хвостовые нули четырёхбайтного стартового кода
    return stream.subarray(start, end);
  });
}

const nalType = (nal: Buffer) => (nal[0]! >> 1) & 0x3f;

function encodeHevc(png: Buffer): Buffer[] {
  const dir = mkdtempSync(path.join(tmpdir(), "heic-fixture-"));
  try {
    const input = path.join(dir, "in.png");
    const output = path.join(dir, "out.hevc");
    writeFileSync(input, png);
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", input,
      "-c:v", "libx265", "-pix_fmt", "yuv420p", "-x265-params", "log-level=error:keyint=1:info=0",
      "-frames:v", "1", "-f", "hevc", output,
    ]);
    return splitAnnexB(readFileSync(output));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** HEVCDecoderConfigurationRecord: Main, 8 бит, 4:2:0, длина NAL — 4 байта; массивы VPS/SPS/PPS. */
function hvcC(nals: Buffer[]): Buffer {
  const arrays = [32, 33, 34].map((type) => {
    const nal = nals.find((n) => nalType(n) === type);
    if (!nal) throw new Error(`нет NAL типа ${type}`);
    return Buffer.concat([u8(0x80 | type), u16(1), u16(nal.length), nal]);
  });
  return box(
    "hvcC",
    u8(1), u8(0x01), u32(0x60000000), Buffer.alloc(6), u8(90),
    u16(0xf000), u8(0xfc), u8(0xfd), u8(0xf8), u8(0xf8), u16(0), u8(0x0f),
    u8(arrays.length), ...arrays,
  );
}

/** EXIF как у iPhone: Orientation=6, модель и геолокация. Блок HEIF: смещение до заголовка TIFF + данные. */
async function exifItem(): Promise<Buffer> {
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#808080" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({ IFD0: { Make: "Phone", Model: "Phone 15" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 10/1 0/1" } })
    .toBuffer();
  const exif = (await sharp(jpeg).metadata()).exif;
  if (!exif || exif.subarray(0, 4).toString("ascii") !== "Exif") throw new Error("sharp не отдал EXIF");
  return Buffer.concat([u32(6), exif]); // 6 = длина "Exif\0\0" перед TIFF
}

function heif(nals: Buffer[], exif: Buffer): Buffer {
  const slices = nals.filter((n) => nalType(n) < 32);
  const image = Buffer.concat(slices.flatMap((n) => [u32(n.length), n]));

  const ftyp = box("ftyp", Buffer.from("heic", "ascii"), u32(0), Buffer.from("mif1heic", "ascii"));
  const infe = (id: number, type: string) => fullBox("infe", 2, 0, u16(id), u16(0), Buffer.from(type, "ascii"), u8(0));
  const ipco = box(
    "ipco",
    hvcC(nals),
    fullBox("ispe", 0, 0, u32(WIDTH), u32(HEIGHT)),
    box("irot", u8(3)), // 3 × 90° против часовой = 90° по часовой, как EXIF Orientation=6
  );
  const ipma = fullBox("ipma", 0, 0, u32(1), u16(1), u8(3), u8(0x81), u8(0x02), u8(0x83));
  const iloc = (imageAt: number, exifAt: number) =>
    fullBox("iloc", 0, 0, u8(0x44), u8(0x00), u16(2),
      u16(1), u16(0), u16(1), u32(imageAt), u32(image.length),
      u16(2), u16(0), u16(1), u32(exifAt), u32(exif.length));
  const meta = (imageAt: number, exifAt: number) =>
    fullBox(
      "meta", 0, 0,
      fullBox("hdlr", 0, 0, u32(0), Buffer.from("pict", "ascii"), Buffer.alloc(12), u8(0)),
      fullBox("pitm", 0, 0, u16(1)),
      fullBox("iinf", 0, 0, u16(2), infe(1, "hvc1"), infe(2, "Exif")),
      fullBox("iref", 0, 0, box("cdsc", u16(2), u16(1), u16(1))),
      box("iprp", ipco, ipma),
      iloc(imageAt, exifAt),
    );
  // Смещения в iloc — абсолютные; длина meta от их значений не зависит, поэтому хватает двух проходов.
  const mdatStart = ftyp.length + meta(0, 0).length + 8;
  return Buffer.concat([ftyp, meta(mdatStart, mdatStart + image.length), box("mdat", image, exif)]);
}

const file = heif(encodeHevc(await sourcePng()), await exifItem());
writeFileSync(OUT, file);
process.stdout.write(`${OUT}: ${file.length} байт\n`);

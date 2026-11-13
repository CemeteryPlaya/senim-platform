import { brand } from "@/config/brand";

/** Ссылка «написать в поддержку»: почтовая программа с адресом из конфига бренда (как у «Помощи» в kit). */
export const SUPPORT_HREF = `mailto:${encodeURI(brand.support.email)}`;

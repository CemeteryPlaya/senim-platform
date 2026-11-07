/** Якорь панели подписи документа на экране сделки: на него ведут «Подписать оферту / акт». */
export const signingAnchorId = (documentId: string) => `doc-${documentId}`;

/** Заголовок панели подписи (tabIndex=-1): сюда переводится фокус по «Подписать» и после принятой подписи. */
export const signingTitleId = (documentId: string) => `doc-${documentId}-title`;

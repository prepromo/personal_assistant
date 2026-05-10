/** Карта одного символа в ASCII-цифру или пусто (NFKC + типичные юникод-цифры). */
function asciiDigitFromChar(ch: string): string {
  const cp = ch.codePointAt(0)!;
  if (cp >= 0x30 && cp <= 0x39) return ch;
  if (cp >= 0xff10 && cp <= 0xff19) return String.fromCharCode(0x30 + (cp - 0xff10));
  if (cp >= 0x0660 && cp <= 0x0669) return String.fromCharCode(0x30 + (cp - 0x0660));
  if (cp >= 0x06f0 && cp <= 0x06f9) return String.fromCharCode(0x30 + (cp - 0x06f0));
  if (cp >= 0x0966 && cp <= 0x096f) return String.fromCharCode(0x30 + (cp - 0x0966));
  return "";
}

/**
 * Цифры кода входа Telegram.
 * Убираем длинные цепочки цифр (часто там номер телефона из того же уведомления),
 * затем выбираем блок из 5–6 цифр, чтобы не склеивать номер и код.
 */
export function extractTelegramLoginCodeDigits(text: string): string {
  /** BiDi / format chars из копипаста Telegram */
  let s = text.normalize("NFKC").replace(/\p{Cf}/gu, "");
  // Цепочки из 10+ цифр подряд — почти всегда телефон / идентификатор, не код входа
  s = s.replace(/\d{10,}/g, " ");
  // Разряжённые номера: +7 999 123-45-67 и т.п.
  s = s.replace(/\+?\d(?:[\d\s\-–—().]|\u00a0){8,}\d/g, " ");

  let compact = "";
  for (const ch of s) {
    compact += asciiDigitFromChar(ch);
  }

  if (compact.length === 5 || compact.length === 6) return compact;

  const blocks = compact.match(/\d{5,6}/g);
  if (blocks?.length === 1) return blocks[0];
  if (blocks && blocks.length > 1) return blocks[0];

  const head = compact.match(/^(\d{5,6})/);
  if (head) return head[1];

  return compact;
}

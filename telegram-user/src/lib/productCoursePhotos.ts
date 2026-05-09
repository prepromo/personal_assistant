import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Корень пакета `telegram-user` (родитель `src/`). */
const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");

/** Репозиторий VPN_service: родитель каталога telegram-user. */
const DEFAULT_REPO_PHOTOS = path.resolve(PACKAGE_ROOT, "..", "photos");

/** Резервная папка внутри пакета (если скопируете файлы для деплоя). */
const BUNDLED_PHOTOS = path.join(PACKAGE_ROOT, "assets", "course-photos");

const TG_CAPTION_MAX = 1024;

export function coursePhotosDir(): string {
  const override = process.env.PRODUCT_BOT_PHOTOS_DIR?.trim();
  if (override) return path.resolve(override);
  if (fs.existsSync(BUNDLED_PHOTOS)) return BUNDLED_PHOTOS;
  return DEFAULT_REPO_PHOTOS;
}

/**
 * Файлы из папки `photos/` в корне репо — порядок соответствует **шагам курса 0…5**
 * (номера фото сопоставлены смыслу текста шага).
 */
export const COURSE_STEP_FILES = [
  "фото 1.png",
  "фото 2 безопасность.png",
  "фото 4 агент и контакт.png",
  "фото 3 напоминания.png",
  "фото 5 меню.png",
  "фото 6 воркер.png",
] as const;

/** Иллюстрация к сообщению после курса / «зачем connect». */
export const POST_COURSE_PHOTO_FILE = "фото 6 воркер.png";

export function absCoursePhoto(stepIndex: number): string | null {
  const file = COURSE_STEP_FILES[stepIndex];
  if (!file) return null;
  const full = path.join(coursePhotosDir(), file);
  return fs.existsSync(full) ? full : null;
}

export function absPostCoursePhoto(): string | null {
  const full = path.join(coursePhotosDir(), POST_COURSE_PHOTO_FILE);
  return fs.existsSync(full) ? full : null;
}

/** Подпись к фото в Telegram (лимит 1024). При обрезке убираем Markdown, чтобы не ломать разметку. */
export function telegramPhotoCaption(text: string): { caption: string; parse_mode?: "Markdown" } {
  if (text.length <= TG_CAPTION_MAX) return { caption: text, parse_mode: "Markdown" };
  const plain = text.replace(/\*\*/g, "").slice(0, TG_CAPTION_MAX - 2);
  return { caption: `${plain}…` };
}

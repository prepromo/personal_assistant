import { Bot, InlineKeyboard, InputFile, Keyboard } from "grammy";
import type { Context } from "grammy";
import type { ComradeTemplateType } from "../lib/prismaComradeTypes.js";
import { dbComradeTask, prisma } from "../lib/prisma.js";
import {
  ensureBotBinding,
  getDialogMeta,
  setDialogMeta,
  resetDialogFsm,
  type DialogMeta,
} from "../lib/botBinding.js";
import { parsePolicy, defaultPolicy, type AgentScope } from "../lib/policy.js";
import { decodeDialogModePayload } from "../lib/productBotDeepLink.js";
import {
  getAccountForTelegramUser,
  formatPolicyLines,
  patchPolicyFromBot,
  toggleAgentAllowedDialog,
  getAllowedDialogIdSet,
  listDialogsPage,
  AGENT_DIALOG_PAGE_SIZE,
} from "../lib/botAgentPolicy.js";
import {
  createProductAgent,
  updateProductAgent,
  deleteProductAgent,
  setDialogAgent,
  MAX_PRODUCT_AGENTS,
} from "../lib/productAgents.js";
import { registerBotChannelIngest } from "../lib/botChannelIngest.js";
import {
  appendProductChatTurn,
  isProductBotChatDisabled,
  runProductBotChatTurn,
} from "../lib/productBotChat.js";
import { finalizeBotOnlyRegistration, hasActiveInBotRegistration } from "../lib/botRegistrationWizard.js";
import {
  parseProductBotNlOutcome,
  formatNlPendingSummary,
  formatNlPickChatsStepHeader,
  executeNlPending,
  isProductBotNlEnabled,
  isProductBotNlConfirmRequired,
  needsNlChatPick,
  nlPendingStripLinkTargets,
  initialNlPickChatIds,
  nlPendingWithLinkTargets,
  buildNlLinkTargetsFromIds,
  NL_AGENT_REQUIRES_MTPROTO_MESSAGE,
  type NlPendingPayload,
} from "../lib/productBotNl.js";
import { enqueueUserAccountOutbound } from "../lib/productBotOutbound.js";
import { enqueueUserAccountOutboundAwaitingConfirm } from "../lib/productBotOutbound.js";
import { COMRADE_TEMPLATE_ORDER, COMRADE_TEMPLATES } from "../lib/comradeTemplates.js";
import { composeComradeFirstMessageToPeer } from "../lib/composeComradeFirstMessageToPeer.js";
import { composeMeetingDraftToPeer } from "../lib/composeMeetingDraftToPeer.js";
import {
  MAX_ACTIVE_REMINDERS,
  MAX_USER_NOTES,
  assertCanAddNote,
  assertCanAddReminder,
  countActiveReminders,
  countUserNotes,
} from "../lib/noteReminderLimits.js";
import { formatTaskLine, listComradeTasksForBucket, type TaskDashboardBucket } from "../lib/comradeTaskService.js";
import { REQUEST_TEMPLATES_HELP_TEXT } from "../lib/productBotRequestTemplates.js";
import {
  needsTelegramMtprotoLogin,
  mtprotoPassword,
  mtprotoSendCode,
  mtprotoSignIn,
} from "../lib/mtprotoLoginService.js";
import {
  activateAfterTelegramInvoicePayment,
  activateSimulatedMonthlyForTelegramUser,
  billingTestBonusDays,
  buildSubscriptionInvoicePayload,
  getCabinetUserIdForTelegramUser,
  parseCabinetUserIdFromInvoicePayload,
} from "../lib/botTelegramBilling.js";
import { PRODUCT_COURSE_STEPS, courseKeyboard } from "./productBotCourse.js";
import { absCoursePhoto, absPostCoursePhoto, telegramPhotoCaption } from "../lib/productCoursePhotos.js";

function isMessageNotModifiedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("message is not modified");
}

const REMINDER_WIZARD_STEPS = new Set<NonNullable<DialogMeta["step"]>>([
  "rem_1",
  "rem_2",
  "rem_3",
  "rem_confirm",
  "rem_reschedule",
]);

function isReminderWizardStep(step: DialogMeta["step"] | undefined): boolean {
  return step !== undefined && REMINDER_WIZARD_STEPS.has(step);
}

/** Выход из мастера напоминания без слэша (см. также команду /cancel). */
function isPlaintextWizardCancel(text: string): boolean {
  const s = text.trim().toLowerCase();
  return s === "отмена" || s === "отменить" || s === "cancel" || s === "стоп" || s === "выход";
}

async function shouldPromptTelegramConnect(telegramUserId: number): Promise<boolean> {
  const tid = String(telegramUserId);
  const b = await prisma.tgBotUserBinding.findUnique({ where: { telegramUserId: tid } });
  if (!b) return false;
  const cab = await prisma.cabinetUser.findUnique({ where: { appUserId: b.appUserId } });
  if (!cab) return false;
  const sub = await prisma.cabinetSubscription.findUnique({ where: { cabinetUserId: cab.id } });
  if (sub?.status !== "active") return false;
  return needsTelegramMtprotoLogin(b.appUserId);
}

/** Подсказка при пустом списке TgDialog: отличить «нет сессии» от «сессия есть, ждём worker». */
async function emptyTgDialogsHint(telegramUserId: number | undefined): Promise<string> {
  if (telegramUserId === undefined) {
    return "Диалогов в базе пока нет. Для **списка личных чатов** выполните **`/connect`** и на машине с API/БД запустите **worker** (`telegram-user/scripts/start-worker.ps1`).";
  }
  const acc = await getAccountForTelegramUser(telegramUserId);
  if (!acc) {
    return "Сначала **`/connect`** в этом чате (номер и код из Telegram) или в веб-кабинете.";
  }
  const tg = await prisma.tgAccount.findUnique({
    where: { id: acc.accountId },
    select: { sessionEnc: true },
  });
  const hasSession = tg?.sessionEnc != null && tg.sessionEnc.length > 0;
  if (!hasSession) {
    return "Сессия не сохранена — выполните **`/connect`** снова.";
  }
  return [
    "Личный аккаунт **уже подключён** — вход прошёл.",
    "",
    "Список чатов в базе заполняет **отдельный процесс worker** (не часть бота): в другом терминале на той же машине, что API и БД, запустите `telegram-user/scripts/start-worker.ps1` и подождите до минуты.",
    "",
    "**Заметки, агенты, свободный чат с ботом** работают и без worker; worker нужен для **синхронизации диалогов** и **отправки с вашего личного Telegram**.",
  ].join("\n");
}

async function replyTelegramConnectOffer(ctx: Context): Promise<void> {
  const kb = new InlineKeyboard()
    .text("Подключить личный Telegram", "mtp:start")
    .row()
    .text("Отмена", "mtp:cancel");
  await ctx.reply(
    [
      "У вас **оплачен тариф**, но личный Telegram ещё **не подключён**.",
      "",
      "Без этого не будут видны диалоги и не заработают автоответы **с вашего аккаунта**.",
      "",
      "Нажмите кнопку и введите **номер** (`+7…`), затем **код** из Telegram. Сообщения с номером, кодом и паролем бот **старается удалить** из чата после обработки.",
    ].join("\n"),
    { parse_mode: "Markdown", reply_markup: kb },
  );
}

/** Удаляет сообщение пользователя (номер/код/пароль), если API позволяет. */
async function deleteUserMessageIfPossible(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  const mid = ctx.message?.message_id;
  if (chatId === undefined || mid === undefined) return;
  try {
    await ctx.api.deleteMessage(chatId, mid);
  } catch {
    /* нет прав или слишком старое сообщение */
  }
}

function isActiveMtprotoWizard(meta: Pick<DialogMeta, "step">): boolean {
  return meta.step === "mtproto_phone" || meta.step === "mtproto_code" || meta.step === "mtproto_2fa";
}

/** Не затирать шаг /connect при сбросе онбординга или /start. */
function mtprotoWizardPatchOrIdle(
  meta: DialogMeta,
): Pick<DialogMeta, "step"> & Partial<Pick<DialogMeta, "mtprotoDraft">> {
  if (isActiveMtprotoWizard(meta)) {
    return { step: meta.step, mtprotoDraft: meta.mtprotoDraft };
  }
  return { step: "idle", mtprotoDraft: undefined };
}

function mtprotoSignInUserHint(errMsg: string): string | null {
  const u = errMsg.toUpperCase();
  if (u.includes("PHONE_CODE_HASH_EMPTY") || u.includes("WIZARD_CORRUPT_PHONE_CODE_HASH")) {
    return "Сервер не смог сопоставить код с запросом (часто после сбоя или двойного запроса). Нажмите **`/connect`** и введите **номер ещё раз**, затем **новый** код.";
  }
  if (u.includes("PHONE_CODE_EXPIRED") || u.includes("PHONE_CODE_INVALID")) {
    return "Telegram не принял код. Нажмите **`/connect`**, введите **номер снова** и затем **только что пришедший** код (один запрос — один код).";
  }
  if (u.includes("CODE_MUST_BE") || u.includes("code_must_be")) {
    return "Нужны **ровно 5 или 6 цифр** кода подряд.";
  }
  if (u.includes("NO_PENDING_LOGIN") || u.includes("SEND_CODE_FIRST")) {
    return "Сессия входа сброшена. Начните снова: **`/connect`** и номер.";
  }
  if (u.includes("SIGNUP") || u.includes("TERMS_OF_SERVICE")) {
    return "Этот номер в Telegram ещё не оформлен как аккаунт или ждёт соглашение в официальном клиенте. Один раз войдите в **официальный Telegram** с этого номера, затем снова **`/connect`**.";
  }
  return null;
}

async function beginMtprotoConnectWizard(ctx: Context): Promise<void> {
  const uid = ctx.from?.id;
  if (uid === undefined) return;
  const { appUserId } = await ensureBotBinding(uid);
  const needs = await needsTelegramMtprotoLogin(appUserId);
  if (!needs) {
    await ctx.reply(
      [
        "Личный Telegram **уже подключён** — код вводить не нужно.",
        "",
        "Если **список чатов пустой**, в отдельном терминале запустите **worker** (`telegram-user/scripts/start-worker.ps1`) рядом с API — это не автозапуск после входа.",
        "",
        "Переподключить аккаунт можно только после **сброса сессии** (internal `reset-session` или поддержка).",
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: mainMenu() },
    );
    return;
  }
  const prev = await getDialogMeta(uid);
  await setDialogMeta(uid, {
    step: "mtproto_phone",
    mtprotoDraft: undefined,
    productChatHistory: prev.productChatHistory,
    onboardingDone: prev.onboardingDone,
    onboardingStep: prev.onboardingStep,
  });
  await ctx.reply(
    [
      "**Подключение личного Telegram**",
      "",
      "Одним сообщением пришлите **номер** в формате `+79991234567`.",
      "Код придёт в Telegram — **следующим сообщением** только цифры кода.",
      "При 2FA — следующим сообщением **пароль**.",
    ].join("\n"),
    { parse_mode: "Markdown", reply_markup: mainMenu() },
  );
}

/** Публичный origin API/кабинета (в проде — https://ваш-домен). */
function getProductPublicBaseUrl(): string {
  const raw =
    process.env.PRODUCT_PUBLIC_BASE_URL?.trim() ||
    process.env.CABINET_PUBLIC_URL?.trim() ||
    "http://127.0.0.1:4050";
  return raw.replace(/\/$/, "");
}

/** URL страницы кабинета (путь можно переопределить). */
function getCabinetHtmlUrl(): string {
  const path = (process.env.PRODUCT_CABINET_PATH?.trim() || "cabinet.html").replace(/^\//, "");
  return `${getProductPublicBaseUrl()}/${path}`;
}

function formatCabinetCard(appUserId: string): string {
  const base = getProductPublicBaseUrl();
  const url = getCabinetHtmlUrl();
  const isGuestBotId = /^bot-\d+$/.test(appUserId);
  return [
    "📱 **Сводка (всё можно в боте)**",
    "",
    "**Тариф:** `/pay` — тест или оплата в Telegram (если настроены Stars / провайдер).",
    "**Личный Telegram:** `/connect` или кнопка при запросе в разделах.",
    "",
    isGuestBotId
      ? "Статус: **гостевой** — `/register`, затем `/pay` и `/connect`."
      : "Статус: **аккаунт есть** — если чатов в «Режим чатов» нет, запустите **worker** отдельно (см. `/connect` после входа).",
    "",
    "Сайт (опционально): " + base + " · " + url,
    "",
    base.includes("127.0.0.1")
      ? "⚠️ `127.0.0.1` с телефона не откроется. Для прода задайте `PRODUCT_PUBLIC_BASE_URL`."
      : "",
  ].join("\n");
}

function formatCabinetHelp(appUserId: string): string {
  const url = getCabinetHtmlUrl();
  const isGuestBotId = /^bot-\d+$/.test(appUserId);
  return [
    "🧾 **Тех. данные**",
    "",
    "**Ваш `appUserId`** (для поддержки / диагностики):",
    "",
    `\`${appUserId}\``,
    "",
    `🌐 Кабинет: ${url}`,
    "",
    isGuestBotId
      ? "Статус: **гостевой режим**. Чтобы подключить диалоги и полный функционал — завершите регистрацию/вход на сайте."
      : "Статус: **аккаунт найден** (если какие-то разделы пустые — проверьте подключение на сайте).",
    "",
    url.includes("127.0.0.1")
      ? "⚠️ `127.0.0.1` с телефона не откроется. Для прод/серверного доступа задайте `PRODUCT_PUBLIC_BASE_URL`."
      : "",
  ].join("\n");
}

function mainMenu() {
  return new Keyboard()
    .text("Обучение")
    .text("Заметки")
    .row()
    .text("Агенты")
    .text("Настройки")
    .row()
    .text("Команды")
    .resized();
}

/** Регистрация в боте одним действием (без пошагового мастера и без сайта). */
async function replyRegistrationWizardEntry(ctx: Context) {
  const uid = ctx.from?.id;
  if (uid === undefined) return;
  await ensureBotBinding(uid);
  if (await hasActiveInBotRegistration(uid)) {
    const { appUserId } = await ensureBotBinding(uid);
    await ctx.reply(
      [
        "У вас уже есть **активная подписка** (бот или веб).",
        "",
        `**appUserId:** \`${appUserId}\``,
        "",
        "**/pay** — тариф, **`/connect`** — личный Telegram. **/id** — тех.данные.",
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: mainMenu() },
    );
    return;
  }
  const r = await finalizeBotOnlyRegistration(uid);
  if (!r.ok) {
    await ctx.reply("Не удалось зарегистрировать: " + r.error, { reply_markup: mainMenu() });
    return;
  }
  const extra = r.extendedExistingPeriod ? "\n\nПериод подписки **продлён** на месяц." : "";
  await ctx.reply(
    [
      "**Готово** — аккаунт и подписка оформлены.",
      "",
      "**appUserId** (тех.данные):",
      `\`${r.appUserId}\``,
      "",
      "Дальше: **`/pay`** (если нужно) и **`/connect`** — телефон и код в этом чате.",
      extra,
    ].join("\n"),
    { parse_mode: "Markdown", reply_markup: mainMenu() },
  );
}

const ONBOARDING_STEPS = [
  [
    "👋 **Добро пожаловать в Comrade AI**",
    "",
    "Я помогаю вести **контактные задачи** (после подключения вашего Telegram), **напоминания** и **заметки** — прямо здесь.",
    "",
    "Дальше два шага: быстро настроить аккаунт и при желании подключить личный профиль, чтобы я мог работать с вашими диалогами.",
  ].join("\n"),
  [
    "⚡ **С чего начать**",
    "",
    "**`/register`** — создать аккаунт и получить доступ к функциям.",
    "**`/pay`** — тариф (на сервере может быть тестовый режим, Stars или другой провайдер).",
    "**`/connect`** — вход вашего **личного Telegram** (номер → код); рядом с API должен работать **worker**, чтобы подтянуть список чатов.",
    "",
    "Меню внизу открывает разделы; полный список команд — кнопка **«Команды»** или **`/help`**.",
  ].join("\n"),
];

/** Приветствие после первичного онбординга (повторный /start). */
const START_RETURNING_USER_TEXT = [
  "Привет! Я **Comrade AI** — агент-помощник в Telegram.",
  "",
  "**Что я умею**",
  "· **Задачи про людей** — когда будете готовы связать ваш личный аккаунт, смогу помогать с черновиками и напоминаниями по вашим диалогам (всё с вашего подтверждения здесь).",
  "· **Напоминания и заметки** — прямо в этом чате с ботом.",
  "· **Обычный язык в сообщениях** — если на сервере включён NL, постараюсь понять запрос и выполнить его в рамках продукта.",
  "",
  "**Как пользоваться**",
  "Кнопки меню внизу **или** пишите в чат то, что нужно.",
  "",
  "Если только начинаете — откройте **«Обучение»**: там сначала смысл продукта; **зачем нужен личный Telegram** объясню отдельным сообщением в конце тура. Справка по командам: **`/help`** или кнопка **«Команды»**.",
].join("\n");

/** После «Я всё понял» в курсе — практический блок про /connect и тариф (не смешиваем с «красивыми» шагами). */
const POST_COURSE_FOLLOWUP_TEXT = [
  "🔐 **Зачем нужен личный Telegram**",
  "",
  "Чтобы я мог помогать **с вашими реальными переписками** — видеть нужные диалоги и по вашему подтверждению отправлять сообщения **от вашего имени**, нужен **один раз** вход вашего аккаунта через **`/connect`** в этом чате (номер → код из приложения Telegram).",
  "",
  "**Заметки и напоминания здесь** работают без этого. Подключение нужно именно для **задач на контактов** из вашего списка чатов.",
  "",
  "**Тариф:** если доступ ещё не оформлен — **`/register`**, затем при необходимости **`/pay`** (как настроено на сервере). **`/id`** — технический идентификатор для поддержки.",
  "",
  "Список личных чатов подтягивает **worker** рядом с API после успешного входа.",
].join("\n");

const HELP_TEXT = [
  "📌 **Список команд · Comrade AI**",
  "",
  "**/start** — приветствие и меню.",
  "**/menu** — напоминание про клавиатуру.",
  "**/help** — это сообщение.",
  "",
  "**/register** — аккаунт в боте.",
  "**/pay** — тариф (тест `BILLING_ALLOW_SIMULATED_PAYMENT=1`, либо Stars, либо провайдер).",
  "**/connect** — личный Telegram. Исходящие контактам — **только после подтверждения** в этом боте.",
  "",
  "**/agents**, **/notes**, **/agent** — разделы «Агенты», «Заметки», политика агента.",
  "**/id** — тех. данные. **/cancel** — выход из мастера напоминания.",
  "",
  "Меню: **Обучение** · **Заметки** · **Агенты** · **Настройки** · **Команды** (то же, что /help).",
  "",
  "Свободный текст: при `PRODUCT_BOT_NL=1` NL распознаёт задачи и **по умолчанию сразу выполняет**. Обязательное подтверждение: `PRODUCT_BOT_NL_CONFIRM=1`.",
  "",
  "**Worker** — синхронизация чатов и очередь отправки после `/connect`.",
].join("\n");

async function sendReturningWelcomePack(ctx: Context): Promise<void> {
  await ctx.reply(START_RETURNING_USER_TEXT, {
    parse_mode: "Markdown",
    reply_markup: mainMenu(),
  });
  await ctx.reply(
    "Можем за пару минут пройти **обучение** по экранам — или откройте его позже кнопкой «Обучение» ниже. Объяснение про личный Telegram — и после тура, и по кнопке ниже.",
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("📘 Начать обучение", "crs:begin")
        .row()
        .text("Зачем подключать Telegram?", "crs:why_connect"),
    },
  );
}

function registrationKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("✅ Зарегистрироваться", "reg:do").row().text("📘 Обучение", "crs:begin");
}

async function requireRegisteredOrExplain(ctx: Context, telegramUserId: number): Promise<boolean> {
  await ensureBotBinding(telegramUserId);
  if (await hasActiveInBotRegistration(telegramUserId)) return true;
  // Для callbackQuery лучше показать короткую подсказку, но не спамить alert-окнами.
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: "Сначала регистрация" });
  }
  await ctx.reply(
    [
      "Чтобы пользоваться разделами и задачами, сначала нужна **регистрация**.",
      "",
      "Это один клик: создадим аккаунт и активируем доступ. После регистрации предложу подключить личный Telegram (если нужно).",
    ].join("\n"),
    { parse_mode: "Markdown", reply_markup: registrationKeyboard() },
  );
  return false;
}

/** Блок «зачем /connect» + кнопка входа (после курса или по запросу). */
async function replyPostCourseConnectExplainer(
  ctx: Context,
  opts?: { skipIllustration?: boolean },
): Promise<void> {
  const uid = ctx.from?.id;
  if (uid === undefined) return;
  const { appUserId } = await ensureBotBinding(uid);
  const connectKb = new InlineKeyboard().text("Подключить личный Telegram", "mtp:start");
  if (await needsTelegramMtprotoLogin(appUserId)) {
    const photoPath = opts?.skipIllustration ? null : absPostCoursePhoto();
    const cap = telegramPhotoCaption(POST_COURSE_FOLLOWUP_TEXT);
    if (photoPath) {
      await ctx.replyWithPhoto(new InputFile(photoPath), {
        caption: cap.caption,
        ...(cap.parse_mode ? { parse_mode: cap.parse_mode } : {}),
        reply_markup: connectKb,
      });
    } else {
      await ctx.reply(POST_COURSE_FOLLOWUP_TEXT, { parse_mode: "Markdown", reply_markup: connectKb });
    }
  } else {
    await ctx.reply(
      [
        "Личный Telegram **уже подключён** — можно открывать **«Агенты»** и работать с чатами.",
        "",
        "Если списка диалогов нет, на машине с API должен работать **worker**.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  }
}

function nlConfirmKeyboard() {
  return new InlineKeyboard().text("Подтвердить", "nl:yes").row().text("Отмена", "nl:no");
}

const NL_PICK_PAGE_SIZE = 8;

function buildNlPickChatsKeyboard(
  dialogs: { id: string; title: string | null; peerKey: string }[],
  selectedIds: string[],
  page: number,
): InlineKeyboard {
  const selected = new Set(selectedIds);
  const kb = new InlineKeyboard();
  const n = dialogs.length;
  /** Пустой список: сначала «Далее» и «Отмена» в один ряд — чтобы кнопки не уезжали под длинный текст. */
  if (n === 0) {
    return kb.text("Далее", "nl:pick:next").text("Отмена", "nl:no");
  }
  const totalPages = Math.max(1, Math.ceil(n / NL_PICK_PAGE_SIZE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const slice = dialogs.slice(p * NL_PICK_PAGE_SIZE, (p + 1) * NL_PICK_PAGE_SIZE);
  for (const d of slice) {
    const mark = selected.has(d.id) ? "✓ " : "";
    const raw = (d.title || d.peerKey || d.id).slice(0, 38);
    kb.text(`${mark}${raw}`, `nl:pick:t:${d.id}`).row();
  }
  if (totalPages > 1) {
    const prev = p > 0 ? p - 1 : p;
    const next = p < totalPages - 1 ? p + 1 : p;
    kb
      .text("◀", `nl:pick:pg:${prev}`)
      .text(`${p + 1}/${totalPages}`, "nl:pick:noop")
      .text("▶", `nl:pick:pg:${next}`)
      .row();
  }
  kb.text("Далее", "nl:pick:next").row();
  kb.text("Отмена", "nl:no");
  return kb;
}

/** MTProto-диалоги + те же peer, что в «чатах бота», если для них уже есть строка TgDialog. */
async function fetchDialogsForNlPick(
  telegramUserId: number,
  appUserId: string,
): Promise<{ dialogs: { id: string; title: string | null; peerKey: string }[]; supplementText: string }> {
  const acc = await getAccountForTelegramUser(telegramUserId);
  const base = acc
    ? await prisma.tgDialog.findMany({
        where: { accountId: acc.accountId },
        take: 40,
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, peerKey: true },
      })
    : [];
  const ids = new Set(base.map((d) => d.id));
  const botChats = await prisma.botConnectedChat.findMany({
    where: { appUserId },
    take: 30,
    orderBy: { createdAt: "desc" },
  });
  const extra: typeof base = [];
  let supplementText = "";
  if (acc && botChats.length) {
    const peerKeys = [...new Set(botChats.map((c) => c.telegramChatId))];
    const resolved =
      peerKeys.length === 0
        ? []
        : await prisma.tgDialog.findMany({
            where: { accountId: acc.accountId, peerKey: { in: peerKeys } },
            select: { id: true, title: true, peerKey: true },
          });
    const resolvedByPeer = new Map(resolved.map((d) => [d.peerKey, d]));
    for (const c of botChats) {
      const d = resolvedByPeer.get(c.telegramChatId);
      if (d && !ids.has(d.id)) {
        extra.push({
          id: d.id,
          title: (c.title && c.title.trim()) || d.title,
          peerKey: d.peerKey,
        });
        ids.add(d.id);
      }
    }
    const matchedPeers = new Set([...base, ...extra].map((x) => x.peerKey));
    const unmatched = botChats.filter((c) => !matchedPeers.has(c.telegramChatId));
    if (unmatched.length) {
      supplementText = [
        "",
        "**Чаты бота** (пока нет строки MTProto с тем же id — **кнопку** поставить нельзя):",
        "запустите **worker** (синхронизация) или перешлите сообщение из чата боту.",
        ...unmatched.map(
          (c) => `· ${(c.title || "без названия").slice(0, 44)} — \`${c.telegramChatId}\``,
        ),
      ].join("\n");
    }
  }
  const dialogs = [...base, ...extra];
  if (dialogs.length === 0 && !supplementText) {
    supplementText = `\n\n**Сейчас нечего отметить:** ${await emptyTgDialogsHint(telegramUserId)} Добавить чат можно пересланным сообщением боту.`;
  }
  return { dialogs, supplementText };
}

function remConfirmKeyboard() {
  return new InlineKeyboard().text("Подтвердить", "rm:yes").row().text("Отмена", "rm:no");
}

function outboundConfirmKeyboard() {
  return new InlineKeyboard()
    .text("Отправить", "ob:yes")
    .text("Изменить", "ob:edit")
    .row()
    .text("Отмена", "ob:no");
}

function pendingSendConfirmKeyboard(pendingId: string) {
  return new InlineKeyboard().text("Отправить", `ps:yes:${pendingId}`).row().text("Отмена", `ps:no:${pendingId}`);
}

function agentCreateConfirmKeyboard() {
  return new InlineKeyboard().text("Создать", "ag:yes").row().text("Отмена", "ag:no");
}

async function runNlOpenSection(ctx: Context, section: "agents" | "notes" | "chats"): Promise<void> {
  switch (section) {
    case "agents":
      await showAgentsHub(ctx, false);
      break;
    case "notes":
      await showNotesHub(ctx, false);
      break;
    case "chats":
      await showChatsHub(ctx, 0, false);
      break;
  }
}

async function showAgentSettingsPanel(ctx: Context, useEdit: boolean): Promise<void> {
  const uid = ctx.from?.id;
  if (uid === undefined) return;
  if (await shouldPromptTelegramConnect(uid)) {
    await replyTelegramConnectOffer(ctx);
    return;
  }
  const acc = await getAccountForTelegramUser(uid);
  if (!acc) {
    await ctx.reply(
      [
        "Личный Telegram для этого аккаунта ещё не привязан.",
        "",
        "Выполните **`/connect`** здесь или подключите аккаунт в **веб-кабинете** — затем откроются политика и список чатов.",
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: mainMenu() },
    );
    return;
  }
  const tg = await prisma.tgAccount.findUnique({ where: { id: acc.accountId } });
  if (!tg) return;
  const policy = { ...defaultPolicy(), ...parsePolicy(tg.policyJson) };
  const lines = formatPolicyLines(policy);
  const kb = new InlineKeyboard()
    .text(policy.autoInGroups ? "✓ Группы вкл" : "Группы вкл", "pol:g:1")
    .text(!policy.autoInGroups ? "✓ Группы выкл" : "Группы выкл", "pol:g:0")
    .row()
    .text(policy.agentScope === "all" ? "✓ Все личные чаты" : "Все личные чаты", "pol:c:all")
    .text(
      policy.agentScope === "allowlist" ? "✓ Только список" : "Только список",
      "pol:c:allowlist",
    )
    .row();
  if (policy.agentScope === "allowlist") {
    kb.text("Список для агента (вкл/выкл)", "agl:0").row();
  }
  kb.text("« Настройки", "st:hub").row();
  const fullText = [
    "**Настройки безопасности** (политика MTProto / агент).",
    "Исходящие контактам по задачам — **только** после «Отправить» в этом боте.",
    "",
    lines,
    "",
    "Нужны: API :4050, LLM в .env; **worker** — синхронизация чатов и очередь отправки.",
  ].join("\n");
  if (useEdit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(fullText, { reply_markup: kb });
    } catch (e) {
      if (!isMessageNotModifiedError(e)) throw e;
    }
  } else {
    await ctx.reply(fullText, { reply_markup: kb });
  }
}

async function showAgentsHub(ctx: Context, edit: boolean): Promise<void> {
  const uid = ctx.from?.id;
  if (uid === undefined) return;
  const { appUserId } = await ensureBotBinding(uid);
  const agents = await prisma.productAgent.findMany({
    where: { appUserId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const n = agents.length;
  const kb = new InlineKeyboard().text("Безопасность / политика", "pol:panel").row();
  for (const a of agents) {
    const label = `${a.enabled ? "✓" : "○"} ${a.name}`.slice(0, 38);
    kb.text(label, `pag:v:${a.id}`).row();
  }
  if (n < MAX_PRODUCT_AGENTS) {
    kb.text("➕ Добавить агента", "pag:add").row();
  }
  const text = [
    `**Агенты** (${n}/${MAX_PRODUCT_AGENTS})`,
    "",
    "Логические ассистенты: инструкции и привязка к диалогам. Политика отправки — в **Безопасность / политика**.",
  ].join("\n");
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    } catch (e) {
      if (!isMessageNotModifiedError(e)) throw e;
    }
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
}

async function showAgentCard(ctx: Context, agentId: string): Promise<void> {
  const uid = ctx.from?.id;
  if (uid === undefined) return;
  const { appUserId } = await ensureBotBinding(uid);
  const a = await prisma.productAgent.findFirst({ where: { id: agentId, appUserId } });
  if (!a) {
    await ctx.reply("Агент не найден.");
    return;
  }
  const dlgCount = await prisma.productAgentDialog.count({ where: { productAgentId: a.id } });
  const kb = new InlineKeyboard()
    .text("Изменить инструкции", `pag:prm:${a.id}`)
    .row()
    .text("Назначить чаты", `pag:asgn:${a.id}`)
    .row()
    .text(a.isDefault ? "✓ По умолчанию" : "Сделать по умолчанию", `pag:def:${a.id}`)
    .text(a.enabled ? "Выключить" : "Включить", `pag:en:${a.id}`)
    .row()
    .text("Удалить", `pag:del:${a.id}`)
    .row()
    .text("« К списку", "pag:main")
    .row();
  const promptPreview = a.promptExtras.trim() || "(нет)";
  const text = [
    `**${a.name}**`,
    `Диалогов с привязкой: ${dlgCount}`,
    `По умолчанию: ${a.isDefault ? "да" : "нет"}`,
    "",
    "Инструкции:",
    promptPreview.slice(0, 1500),
  ].join("\n");
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    } catch (e) {
      if (!isMessageNotModifiedError(e)) throw e;
    }
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
}

async function buildAssignMarkup(
  accountId: string,
  page: number,
  agentId: string,
  telegramUserId: number | undefined,
) {
  const { dialogs, total } = await listDialogsPage(accountId, page);
  const kb = new InlineKeyboard();
  for (const d of dialogs) {
    const label = `${(d.title || d.peerKey).slice(0, 28)}`.slice(0, 38);
    kb.text(label, `pds:${d.id}`).row();
  }
  const pages = Math.max(1, Math.ceil(total / AGENT_DIALOG_PAGE_SIZE));
  if (pages > 1) {
    if (page > 0) kb.text("« Пред.", `pda:${page - 1}`);
    kb.text(`${page + 1}/${pages}`, "pad:noop");
    if (page < pages - 1) kb.text("След. »", `pda:${page + 1}`);
    kb.row();
  }
  kb.text("« К карточке агента", `pag:v:${agentId}`).row();
  const head =
    dialogs.length === 0
      ? await emptyTgDialogsHint(telegramUserId)
      : `Выберите чат для привязки к агенту (стр. ${page + 1}/${pages}):`;
  return { text: head, markup: kb };
}

async function sendOrEditAssign(
  ctx: Context,
  accountId: string,
  page: number,
  agentId: string,
  edit: boolean,
): Promise<void> {
  const { text, markup } = await buildAssignMarkup(accountId, page, agentId, ctx.from?.id);
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { reply_markup: markup });
    } catch (e) {
      if (!isMessageNotModifiedError(e)) throw e;
    }
  } else {
    await ctx.reply(text, { reply_markup: markup });
  }
}

async function buildAllowlistMarkup(accountId: string, page: number, telegramUserId: number | undefined) {
  const { dialogs, total } = await listDialogsPage(accountId, page);
  const allowed = await getAllowedDialogIdSet(accountId);
  const kb = new InlineKeyboard();
  for (const d of dialogs) {
    const on = allowed.has(d.id);
    const label = `${on ? "✅" : "⬜"} ${(d.title || d.peerKey).slice(0, 28)}`.slice(0, 38);
    kb.text(label, `ag:t:${page}:${d.id}`).row();
  }
  const pages = Math.max(1, Math.ceil(total / AGENT_DIALOG_PAGE_SIZE));
  if (pages > 1) {
    if (page > 0) kb.text("« Пред.", `agl:${page - 1}`);
    kb.text(`${page + 1}/${pages}`, "ag:noop");
    if (page < pages - 1) kb.text("След. »", `agl:${page + 1}`);
    kb.row();
  }
  kb.text("« К безопасности / политике", "pol:panel").row();
  const head =
    dialogs.length === 0
      ? await emptyTgDialogsHint(telegramUserId)
      : `Чаты (стр. ${page + 1}/${pages}): нажмите, чтобы вкл/выкл для агента.`;
  return { text: head, markup: kb };
}

async function sendOrEditAllowlist(ctx: Context, accountId: string, page: number, edit: boolean): Promise<void> {
  const { text, markup } = await buildAllowlistMarkup(accountId, page, ctx.from?.id);
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { reply_markup: markup });
    } catch (e) {
      if (!isMessageNotModifiedError(e)) throw e;
    }
  } else {
    await ctx.reply(text, { reply_markup: markup });
  }
}

function comradeTemplateFromPickIndex(ix: number): ComradeTemplateType | null {
  const t = COMRADE_TEMPLATE_ORDER[ix];
  return t ?? null;
}

async function showComradeTaskDashboardRoot(ctx: Context, edit: boolean): Promise<void> {
  const uid = ctx.from?.id;
  if (uid === undefined) return;
  const { appUserId } = await ensureBotBinding(uid);
  const rows = await dbComradeTask.findMany({
    where: { appUserId },
    orderBy: { updatedAt: "desc" },
    take: 8,
  });
  const kb = new InlineKeyboard()
    .text("Активные", "mvp:db:a")
    .text("Ждут ответа", "mvp:db:w")
    .row()
    .text("Нужно действие", "mvp:db:n")
    .text("Просрочено", "mvp:db:o")
    .row()
    .text("Завершённые", "mvp:db:d")
    .row()
    .text("« Меню", "menu:noop")
    .row();
  const head = rows.length
    ? ["Последние задачи:", ...rows.map(formatTaskLine)].join("\n")
    : "Задач пока нет — откройте **Агенты** → новая задача по шаблону.";
  const text = ["**Мои задачи**", "", head, "", "Фильтры по статусу — кнопки."].join("\n");
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    } catch (e) {
      if (!isMessageNotModifiedError(e)) throw e;
    }
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
}

async function showComradeTaskDashboardBucket(
  ctx: Context,
  bucket: TaskDashboardBucket,
  edit: boolean,
): Promise<void> {
  const uid = ctx.from?.id;
  if (uid === undefined) return;
  const { appUserId } = await ensureBotBinding(uid);
  const list = await listComradeTasksForBucket(appUserId, bucket, 20);
  const labels: Record<TaskDashboardBucket, string> = {
    active: "Активные",
    waiting_reply: "Ожидают ответа",
    needs_action: "Требуют действия",
    overdue: "Просроченные",
    done: "Завершённые",
  };
  const kb = new InlineKeyboard().text("« К списку", "mvp:db:root").row().text("« Меню", "menu:noop").row();
  const body = list.length ? list.map(formatTaskLine).join("\n") : "Пусто.";
  const text = [`**${labels[bucket]}**`, "", body].join("\n");
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    } catch (e) {
      if (!isMessageNotModifiedError(e)) throw e;
    }
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
}

async function showComradeDialogPick(ctx: Context, page: number, edit: boolean): Promise<void> {
  const uid = ctx.from?.id;
  if (uid === undefined) return;
  const acc = await getAccountForTelegramUser(uid);
  if (!acc) {
    await ctx.reply(
      "Нужен подключённый личный Telegram (**/connect**), чтобы выбрать чат для первого сообщения.",
      { parse_mode: "Markdown", reply_markup: mainMenu() },
    );
    return;
  }
  const { dialogs, total } = await listDialogsPage(acc.accountId, page);
  const pages = Math.max(1, Math.ceil(total / AGENT_DIALOG_PAGE_SIZE));
  const kb = new InlineKeyboard();
  for (const d of dialogs) {
    const short = `${(d.title || d.peerKey).slice(0, 28)}`;
    kb.text(short, `ctd:${d.id}`).row();
  }
  if (pages > 1) {
    if (page > 0) kb.text("« Пред.", `crp:${page - 1}`);
    kb.text(`${page + 1}/${pages}`, "crp:noop");
    if (page < pages - 1) kb.text("След. »", `crp:${page + 1}`);
    kb.row();
  }
  kb.text("« Отмена", "ctp:cancel").row();
  const text = [
    "**Выберите чат** для первого сообщения контакту.",
    "",
    "Отправка пойдёт **только после** «Отправить» на следующем шаге.",
  ].join("\n");
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    } catch (e) {
      if (!isMessageNotModifiedError(e)) throw e;
    }
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
}

async function showNotesHub(ctx: Context, edit: boolean): Promise<void> {
  const uid = ctx.from?.id;
  if (uid === undefined) return;
  const { appUserId } = await ensureBotBinding(uid);
  const [notes, nNotes, rems, nRem] = await Promise.all([
    prisma.userNote.findMany({
      where: { appUserId },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    countUserNotes(appUserId),
    prisma.reminder.findMany({
      where: { appUserId, status: { in: ["pending", "awaiting_confirm"] } },
      orderBy: { fireAt: "asc" },
      take: 12,
    }),
    countActiveReminders(appUserId),
  ]);
  const kb = new InlineKeyboard().text("➕ Заметка", "not:add").text("⏰ Напоминание", "not:rem").row();
  for (const n of notes) {
    const preview = n.body.trim().replace(/\s+/g, " ").slice(0, 28);
    kb.text(`📝 ${preview}`, `not:v:${n.id}`).row();
  }
  if (rems.length) {
    kb.text("— напоминания —", "not:noop").row();
    for (const r of rems) {
      const when = r.fireAt.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
      kb.text(`⏰ ${r.title.slice(0, 22)} ${when}`, `not:rv:${r.id}`).row();
    }
  }
  kb.text("« Меню", "menu:noop").row();
  const text = [
    "**Заметки и напоминания**",
    "",
    `Заметки: **${nNotes}/${MAX_USER_NOTES}**. Напоминания активные: **${nRem}/${MAX_ACTIVE_REMINDERS}**.`,
    "",
    notes.length ? "Заметка — нажмите строку, чтобы **удалить**." : "Заметок пока нет.",
    rems.length ? "Напоминание — открыть **перенос/удаление**." : "",
    "",
    "Одноразовые напоминания приходят в этот чат в срок (см. планировщик на API).",
  ]
    .filter(Boolean)
    .join("\n");
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    } catch (e) {
      if (!isMessageNotModifiedError(e)) throw e;
    }
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
}

async function renderOnboarding(ctx: Context, step: number, edit: boolean): Promise<void> {
  const i = Math.min(Math.max(0, step), ONBOARDING_STEPS.length - 1);
  const text = ONBOARDING_STEPS[i] ?? ONBOARDING_STEPS[0];
  const last = i >= ONBOARDING_STEPS.length - 1;
  const kb = new InlineKeyboard()
    .text(last ? "В меню" : "Далее", "onb:next")
    .text("Пропустить", "onb:skip");
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    } catch (e) {
      if (!isMessageNotModifiedError(e)) throw e;
    }
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
}

async function showChatsHub(ctx: Context, page: number, edit: boolean): Promise<void> {
  const uid = ctx.from?.id;
  if (uid === undefined) return;
  if (await shouldPromptTelegramConnect(uid)) {
    await replyTelegramConnectOffer(ctx);
    return;
  }
  const acc = await getAccountForTelegramUser(uid);
  if (!acc) {
    await ctx.reply(
      [
        "Чтобы настраивать чаты по личному Telegram, сначала подключите аккаунт: **`/connect`** в этом чате (номер и код) или вход в **веб-кабинете**.",
        "",
        "Если вы только что ввели код, но здесь всё ещё «не подключено» — перезапустите бота/API или проверьте, что вы в том же боте и том же Telegram-профиле.",
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: mainMenu() },
    );
    return;
  }
  const { dialogs, total } = await listDialogsPage(acc.accountId, page);
  const pages = Math.max(1, Math.ceil(total / AGENT_DIALOG_PAGE_SIZE));
  const kb = new InlineKeyboard();
  for (const d of dialogs) {
    const short = `${(d.title || d.peerKey).slice(0, 34)}`.slice(0, 36);
    kb.text(short, `cdm:${d.id}`).row();
  }
  if (pages > 1) {
    if (page > 0) kb.text("« Пред.", `cht:${page - 1}`);
    kb.text(`${page + 1}/${pages}`, "cht:noop");
    if (page < pages - 1) kb.text("След. »", `cht:${page + 1}`);
    kb.row();
  }
  kb.text("« Меню", "menu:noop").row();
  const head =
    dialogs.length === 0
      ? await emptyTgDialogsHint(uid)
      : "Выберите чат — **назначьте агента** или **напишите первым** (с подтверждением в боте).";
  const text = ["**Режим чатов**", "", head].join("\n");
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    } catch (e) {
      if (!isMessageNotModifiedError(e)) throw e;
    }
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
}

async function showDialogChatPanel(ctx: Context, dialogId: string): Promise<void> {
  const uid = ctx.from?.id;
  if (uid === undefined) return;
  const acc = await getAccountForTelegramUser(uid);
  if (!acc) return;
  const dlg = await prisma.tgDialog.findFirst({
    where: { id: dialogId, accountId: acc.accountId },
  });
  if (!dlg) {
    await ctx.reply("Чат не найден.");
    return;
  }
  const pa = await prisma.productAgentDialog.findUnique({
    where: { dialogId },
    include: { productAgent: true },
  });
  const agentLine = pa?.productAgent ? `Агент: **${pa.productAgent.name}**` : "Агент: по умолчанию";
  const kb = new InlineKeyboard()
    .text("Назначить агента", `cdm:ag:${dialogId}`)
    .row()
    .text("✉️ Написать первым", `out:go:${dialogId}`)
    .row()
    .text("« К списку чатов", "cht:0")
    .row();
  const text = [
    `**${(dlg.title || dlg.peerKey).slice(0, 80)}**`,
    agentLine,
    "",
    "Автоответы **manual / suggest / auto** в продукте **отключены**.",
    "",
    "«Написать первым» — после **«Отправить»** в боте текст попадёт в очередь; **worker** отправит с личного аккаунта.",
  ].join("\n");
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    } catch (e) {
      if (!isMessageNotModifiedError(e)) throw e;
    }
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
}

async function showSettingsHub(ctx: Context, edit: boolean): Promise<void> {
  const uid = ctx.from?.id;
  if (uid === undefined) return;
  const meta = await getDialogMeta(uid);
  const agentNotes = meta.allowAgentNotes === true;
  const { appUserId } = await ensureBotBinding(uid);
  const kb = new InlineKeyboard()
    .text("Кабинет / оплата", "st:cab")
    .row()
    .text("Безопасность MTProto", "st:sec")
    .row()
    .text("Архив задач", "st:arc")
    .row()
    .text("Подключить Telegram", "st:conn")
    .row()
    .text("Чаты и режимы", "st:cht")
    .row()
    .text(agentNotes ? "✓ Агент → заметки" : "○ Агент → заметки", "st:agnote")
    .row()
    .text("Именованные агенты (legacy)", "st:agents")
    .row()
    .text("« Меню", "menu:noop")
    .row();
  const text = [
    "**Настройки**",
    "",
    `**appUserId:** \`${appUserId}\``,
    "",
    "Разделы — кнопками ниже. Подключение личного Telegram: также **`/connect`**.",
  ].join("\n");
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    } catch (e) {
      if (!isMessageNotModifiedError(e)) throw e;
    }
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
}

async function showComradeArchivePanel(ctx: Context, edit: boolean): Promise<void> {
  const uid = ctx.from?.id;
  if (uid === undefined) return;
  const { appUserId } = await ensureBotBinding(uid);
  const list = await listComradeTasksForBucket(appUserId, "done", 25);
  const kb = new InlineKeyboard().text("« Настройки", "st:hub").row().text("« Меню", "menu:noop").row();
  const body = list.length ? list.map(formatTaskLine).join("\n") : "Архив пуст.";
  const text = ["**Архив задач** (завершённые / цель достигнута)", "", body].join("\n");
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    } catch (e) {
      if (!isMessageNotModifiedError(e)) throw e;
    }
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
}

async function sendProductCourseStep(ctx: Context, uid: number, stepIndex: number, edit: boolean): Promise<void> {
  const i = Math.min(Math.max(0, stepIndex), PRODUCT_COURSE_STEPS.length - 1);
  const text = PRODUCT_COURSE_STEPS[i] ?? PRODUCT_COURSE_STEPS[0];
  const kb = courseKeyboard(i);
  const photoPath = absCoursePhoto(i);
  const msg = ctx.callbackQuery?.message;
  const capOpts = telegramPhotoCaption(text);

  if (photoPath) {
    const input = new InputFile(photoPath);
    if (edit && msg?.photo) {
      try {
        await ctx.editMessageMedia(
          {
            type: "photo",
            media: input,
            caption: capOpts.caption,
            ...(capOpts.parse_mode ? { parse_mode: capOpts.parse_mode } : {}),
          },
          { reply_markup: kb },
        );
      } catch (e) {
        if (!isMessageNotModifiedError(e)) {
          await ctx.replyWithPhoto(input, {
            caption: capOpts.caption,
            ...(capOpts.parse_mode ? { parse_mode: capOpts.parse_mode } : {}),
            reply_markup: kb,
          });
        }
      }
    } else {
      await ctx.replyWithPhoto(input, {
        caption: capOpts.caption,
        ...(capOpts.parse_mode ? { parse_mode: capOpts.parse_mode } : {}),
        reply_markup: kb,
      });
    }
  } else if (edit && msg && !msg.photo) {
    try {
      await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    } catch (e) {
      if (!isMessageNotModifiedError(e)) throw e;
    }
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
  await setDialogMeta(uid, { courseStep: i });
}

async function replyComradeTemplatePicker(ctx: Context): Promise<void> {
  const uid = ctx.from?.id;
  if (uid === undefined) return;
  const { appUserId } = await ensureBotBinding(uid);
  if (await needsTelegramMtprotoLogin(appUserId)) {
    await ctx.reply(NL_AGENT_REQUIRES_MTPROTO_MESSAGE, { reply_markup: mainMenu() });
    return;
  }
  const kb = new InlineKeyboard();
  COMRADE_TEMPLATE_ORDER.forEach((t, i) => {
    kb.text(COMRADE_TEMPLATES[t].nameRu.slice(0, 28), `ctp:${i}`).row();
  });
  kb.text("Отмена", "ctp:cancel").row();
  await ctx.reply("Выберите **шаблон** задачи (исходящее — только после «Отправить» в боте):", {
    parse_mode: "Markdown",
    reply_markup: kb,
  });
}

export function createProductBot(token: string): Bot {
  const bot = new Bot(token);

  bot.catch((err) => {
    console.error("productBot error:", err);
  });

  bot.use(async (ctx, next) => {
    const q = ctx.preCheckoutQuery;
    if (q) {
      if (!q.invoice_payload?.startsWith("cab_sub:")) {
        await ctx.answerPreCheckoutQuery(false, { error_message: "Этот платёж не обрабатывается." });
        return;
      }
      const parsed = parseCabinetUserIdFromInvoicePayload(q.invoice_payload);
      if (!parsed) {
        await ctx.answerPreCheckoutQuery(false, { error_message: "Неверный счёт." });
        return;
      }
      const expected = await getCabinetUserIdForTelegramUser(q.from.id);
      if (!expected || expected !== parsed) {
        await ctx.answerPreCheckoutQuery(false, { error_message: "Счёт не для этого аккаунта." });
        return;
      }
      await ctx.answerPreCheckoutQuery(true);
      return;
    }
    const sp = ctx.message?.successful_payment;
    if (sp && ctx.chat?.type === "private") {
      const uid = ctx.from?.id;
      if (uid !== undefined && sp.invoice_payload) {
        const r = await activateAfterTelegramInvoicePayment(uid, sp.invoice_payload);
        if (r.ok) {
          await ctx.reply(
            `Оплата получена. Подписка активна до **${new Date(r.until).toLocaleString("ru-RU")}**.`,
            { parse_mode: "Markdown", reply_markup: mainMenu() },
          );
        }
      }
      return;
    }
    await next();
  });

  registerBotChannelIngest(bot);

  const privateOnly = bot.chatType("private");

  // Global guard: блокируем inline-кнопки, пока нет /register (кроме обучения/регистрации/онбординга и отмен).
  privateOnly.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    if (uid === undefined) return next();
    const data = ctx.callbackQuery?.data;
    if (!data) return next();

    const allowed =
      data.startsWith("onb:") ||
      data.startsWith("crs:") ||
      data.startsWith("reg:") ||
      data === "menu:noop" ||
      data === "mtp:cancel" ||
      data === "nl:no" ||
      data === "ctp:cancel";

    if (allowed) return next();
    if (await hasActiveInBotRegistration(uid)) return next();

    await requireRegisteredOrExplain(ctx, uid);
    return;
  });

  /** true — ответ уже отправлен, обработку лучше прервать */
  async function replyIfAgentFlowsNeedMtproto(ctx: Context, appUserId: string): Promise<boolean> {
    if (!(await needsTelegramMtprotoLogin(appUserId))) return false;
    await ctx.reply(NL_AGENT_REQUIRES_MTPROTO_MESSAGE, { reply_markup: mainMenu() });
    return true;
  }

  async function runNlExecuteAndClear(
    ctx: Context,
    uid: number,
    p: Exclude<NlPendingPayload, { t: "open_section" }>,
    productChatHistory: DialogMeta["productChatHistory"],
  ): Promise<void> {
    const { appUserId } = await ensureBotBinding(uid);
    const acc = await getAccountForTelegramUser(uid);
    const r = await executeNlPending(appUserId, acc?.accountId ?? null, p);
    await setDialogMeta(uid, {
      step: "idle",
      nlPending: undefined,
      nlPickChatIds: undefined,
      nlPickChatsPage: undefined,
      productChatHistory,
    });
    await ctx.reply(r.ok ? r.message : `Ошибка: ${r.message}`, { reply_markup: mainMenu() });
    if (r.ok && r.pendingConfirms?.length) {
      for (const d of r.pendingConfirms) {
        const head = `Черновик для **${d.label.slice(0, 80)}** (ничего не уйдёт без «Отправить»):`;
        await ctx.reply(head, { parse_mode: "Markdown", reply_markup: mainMenu() });
        await ctx.reply(d.text.slice(0, 3500), { reply_markup: pendingSendConfirmKeyboard(d.id) });
      }
    }
  }

  privateOnly.command("start", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    await ensureBotBinding(uid);
    const raw = ctx.message?.text ?? "";
    const startPayload = raw.split(/\s+/).slice(1).join(" ").trim();
    const legacyModeLink = startPayload ? decodeDialogModePayload(startPayload) : null;
    if (legacyModeLink) {
      const pm = await getDialogMeta(uid);
      await setDialogMeta(uid, { onboardingDone: true, ...mtprotoWizardPatchOrIdle(pm) });
      await ctx.reply(
        "Переключение режимов **manual / suggest / auto** по ссылке отключено. Откройте **Настройки** → **Чаты**.",
        { parse_mode: "Markdown", reply_markup: mainMenu() },
      );
      return;
    }
    const meta = await getDialogMeta(uid);
    if (!meta.onboardingDone) {
      await setDialogMeta(uid, { onboardingStep: 0, ...mtprotoWizardPatchOrIdle(meta) });
      await renderOnboarding(ctx, 0, false);
      return;
    }
    await sendReturningWelcomePack(ctx);
  });

  privateOnly.command("menu", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    await ensureBotBinding(uid);
    await ctx.reply(
      [
        "**Меню** (ниже клавиатура).",
        "",
        "Если не знаете, куда нажать — просто напишите вопрос в чат.",
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: mainMenu() },
    );
  });

  privateOnly.callbackQuery(/^reg:do$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    await ensureBotBinding(uid);
    if (await hasActiveInBotRegistration(uid)) {
      await ctx.reply("Вы уже зарегистрированы. Открываю следующий шаг.", { reply_markup: mainMenu() });
      await replyPostCourseConnectExplainer(ctx);
      await ctx.reply("Меню:", { reply_markup: mainMenu() });
      return;
    }
    const r = await finalizeBotOnlyRegistration(uid);
    if (!r.ok) {
      await ctx.reply("Не удалось зарегистрировать: " + r.error, { reply_markup: mainMenu() });
      return;
    }
    await ctx.reply(
      [
        "✅ **Регистрация завершена.**",
        "",
        "Теперь можно подключить личный Telegram, чтобы работать с вашими контактами (это нужно только для задач на людей).",
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: mainMenu() },
    );
    await replyPostCourseConnectExplainer(ctx);
    await ctx.reply("Меню:", { reply_markup: mainMenu() });
  });

  privateOnly.command("cancel", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    await ensureBotBinding(uid);
    const meta = await getDialogMeta(uid);
    if (isReminderWizardStep(meta.step)) {
      await resetDialogFsm(uid);
      await ctx.reply("Мастер напоминания отменён. Дальше пишите в чат как обычно.", {
        reply_markup: mainMenu(),
      });
      return;
    }
    await ctx.reply("Сейчас нет активного мастера напоминания. Команды: /help", {
      reply_markup: mainMenu(),
    });
  });

  privateOnly.command("help", async (ctx) => {
    await ctx.reply(HELP_TEXT, { parse_mode: "Markdown", reply_markup: mainMenu() });
  });

  privateOnly.command("pay", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    await ensureBotBinding(uid);
    const cabId = await getCabinetUserIdForTelegramUser(uid);
    if (!cabId) {
      await ctx.reply("Сначала **/register**.", { parse_mode: "Markdown", reply_markup: mainMenu() });
      return;
    }
    const starsRaw = process.env.TELEGRAM_STARS_PRICE?.trim();
    if (starsRaw && /^\d+$/.test(starsRaw)) {
      const amount = Math.min(10_000, Math.max(1, parseInt(starsRaw, 10)));
      await ctx.replyWithInvoice(
        "Подписка на месяц",
        `Доступ к агентам и диалогам. Бонус +${billingTestBonusDays()} дн. к периоду.`,
        buildSubscriptionInvoicePayload(cabId),
        "XTR",
        [{ label: "Месяц", amount }],
        { provider_token: "" },
      );
      return;
    }
    const token = process.env.TELEGRAM_PAYMENT_PROVIDER_TOKEN?.trim();
    if (token) {
      await ctx.replyWithInvoice(
        "Подписка на месяц",
        `Тестовый платёж. Бонус +${billingTestBonusDays()} дн. к периоду.`,
        buildSubscriptionInvoicePayload(cabId),
        "RUB",
        [{ label: "Месяц", amount: 100 }],
        { provider_token: token },
      );
      return;
    }
    if (process.env.BILLING_ALLOW_SIMULATED_PAYMENT === "1") {
      const sim = await activateSimulatedMonthlyForTelegramUser(uid);
      if (sim.ok) {
        await ctx.reply(
          `Готово: тестовая подписка до **${new Date(sim.until).toLocaleString("ru-RU")}** (+${billingTestBonusDays()} дн. бонус к периоду).`,
          { parse_mode: "Markdown", reply_markup: mainMenu() },
        );
        return;
      }
      await ctx.reply(sim.error, { reply_markup: mainMenu() });
      return;
    }
    await ctx.reply(
      "Оплата не настроена: задайте `BILLING_ALLOW_SIMULATED_PAYMENT=1` для теста, или `TELEGRAM_STARS_PRICE` (число звёзд), или `TELEGRAM_PAYMENT_PROVIDER_TOKEN` для RUB.",
      { parse_mode: "Markdown", reply_markup: mainMenu() },
    );
  });

  privateOnly.command("connect", async (ctx) => {
    await beginMtprotoConnectWizard(ctx);
  });

  privateOnly.command("agents", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    await ensureBotBinding(uid);
    await showAgentsHub(ctx, false);
  });

  privateOnly.command("notes", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    await ensureBotBinding(uid);
    await showNotesHub(ctx, false);
  });

  privateOnly.command("agent", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    await ensureBotBinding(uid);
    await showAgentSettingsPanel(ctx, false);
  });

  privateOnly.hears(/^команды$/iu, async (ctx) => {
    await ctx.reply(HELP_TEXT, { parse_mode: "Markdown", reply_markup: mainMenu() });
  });

  privateOnly.hears("Обучение", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    await ensureBotBinding(uid);
    const meta = await getDialogMeta(uid);
    if (meta.courseDone) {
      const kb = new InlineKeyboard()
        .text("Пройти снова", "crs:replay")
        .row()
        .text("« Меню", "menu:noop");
      await ctx.reply("Вы уже отметили, что всё поняли. Можно пройти обучение ещё раз.", {
        reply_markup: kb,
      });
      return;
    }
    await sendProductCourseStep(ctx, uid, 0, false);
  });

  privateOnly.hears("Настройки", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    if (!(await requireRegisteredOrExplain(ctx, uid))) return;
    await showSettingsHub(ctx, false);
  });

  privateOnly.hears("Агенты", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    if (!(await requireRegisteredOrExplain(ctx, uid))) return;
    const kb = new InlineKeyboard()
      .text("Новая задача (шаблон)", "agm:templates")
      .row()
      .text("Мои задачи", "agm:dash")
      .row()
      .text("Именованные агенты (legacy)", "agm:named");
    await ctx.reply("**Агенты** — выберите действие:", { parse_mode: "Markdown", reply_markup: kb });
  });

  privateOnly.hears("Заметки", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    if (!(await requireRegisteredOrExplain(ctx, uid))) return;
    await showNotesHub(ctx, false);
  });

  privateOnly.hears(/^регистрация$/iu, async (ctx) => {
    await replyRegistrationWizardEntry(ctx);
  });

  privateOnly.command("register", async (ctx) => {
    await replyRegistrationWizardEntry(ctx);
  });

  /** Старые inline-кнопки мастера: шаги больше не используются. */
  privateOnly.callbackQuery(/^regwiz_s_\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Используйте /register" });
  });

  /** Старые сообщения с «Завершить регистрацию» — то же, что /register. */
  privateOnly.callbackQuery("regwiz_done", async (ctx) => {
    await ctx.answerCallbackQuery();
    await replyRegistrationWizardEntry(ctx);
  });

  privateOnly.callbackQuery("regwiz_x", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.callbackQuery?.message) {
      try {
        await ctx.editMessageText("Используйте команду **/register** (регистрация в боте).", {
          parse_mode: "Markdown",
        });
      } catch (e) {
        if (!isMessageNotModifiedError(e)) throw e;
      }
    }
  });

  privateOnly.callbackQuery("mtp:start", async (ctx) => {
    await ctx.answerCallbackQuery();
    await beginMtprotoConnectWizard(ctx);
  });

  privateOnly.callbackQuery("mtp:cancel", async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    await resetDialogFsm(uid);
    await ctx.reply("Ок. Подключение можно начать снова из **Настройки** → чаты или безопасность.", {
      parse_mode: "Markdown",
      reply_markup: mainMenu(),
    });
  });

  privateOnly.command("id", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    await ctx.reply(formatCabinetHelp(appUserId), { parse_mode: "Markdown", reply_markup: mainMenu() });
  });

  privateOnly.hears(/^(Шаблоны|Шаблоны запросов под каждую задачу)$/iu, async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    if (await needsTelegramMtprotoLogin(appUserId)) {
      await ctx.reply(NL_AGENT_REQUIRES_MTPROTO_MESSAGE, { reply_markup: mainMenu() });
      return;
    }
    const lines = COMRADE_TEMPLATE_ORDER.map((t) => {
      const d = COMRADE_TEMPLATES[t];
      return `· **${d.nameRu}** — ${d.goal.slice(0, 120)}${d.goal.length > 120 ? "…" : ""}`;
    }).join("\n");
    const kb = new InlineKeyboard();
    COMRADE_TEMPLATE_ORDER.forEach((t, i) => {
      kb.text(`Создать: ${COMRADE_TEMPLATES[t].nameRu.slice(0, 22)}`, `ctp:${i}`).row();
    });
    kb.text("Отмена", "ctp:cancel").row();
    await ctx.reply(
      [
        "**5 шаблонов** (агент = шаблон + состояние; без автономной переписки):",
        "",
        lines,
        "",
        "Подробное описание шага — после выбора шаблона или кнопки **Агенты** → новая задача.",
        "",
        "Справка текстов для веб/API:",
        REQUEST_TEMPLATES_HELP_TEXT.slice(0, 2800),
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: kb },
    );
  });

  privateOnly.callbackQuery(/^onb:next$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const meta = await getDialogMeta(uid);
    const s = meta.onboardingStep ?? 0;
    if (s >= ONBOARDING_STEPS.length - 1) {
      const fin = await getDialogMeta(uid);
      await setDialogMeta(uid, {
        onboardingDone: true,
        onboardingStep: ONBOARDING_STEPS.length,
        ...mtprotoWizardPatchOrIdle(fin),
      });
      if (ctx.callbackQuery?.message) {
        try {
          await ctx.editMessageText("Готово — познакомимся с возможностями.", { parse_mode: "Markdown" });
        } catch (e) {
          if (!isMessageNotModifiedError(e)) throw e;
        }
      }
      await sendReturningWelcomePack(ctx);
      return;
    }
    const next = s + 1;
    await setDialogMeta(uid, { onboardingStep: next });
    await renderOnboarding(ctx, next, true);
  });

  privateOnly.callbackQuery(/^onb:skip$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const prev = await getDialogMeta(uid);
    await setDialogMeta(uid, { onboardingDone: true, ...mtprotoWizardPatchOrIdle(prev) });
    if (ctx.callbackQuery?.message) {
      try {
        await ctx.editMessageText("Ок — онбординг пропущен, ниже полное приветствие и меню.", { parse_mode: "Markdown" });
      } catch (e) {
        if (!isMessageNotModifiedError(e)) throw e;
      }
    }
    await sendReturningWelcomePack(ctx);
  });

  privateOnly.callbackQuery(/^cht:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const page = parseInt(ctx.match![1], 10);
    await showChatsHub(ctx, page, true);
  });

  privateOnly.callbackQuery(/^cht:noop$/, async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  privateOnly.callbackQuery(/^cdm:ag:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const dialogId = ctx.match![1];
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    await setDialogMeta(uid, { chatPickDialogId: dialogId, step: "idle" });
    const agents = await prisma.productAgent.findMany({
      where: { appUserId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    if (agents.length === 0) {
      await ctx.reply("Сначала создайте агента в разделе **Агенты**.", { parse_mode: "Markdown" });
      return;
    }
    const kb = new InlineKeyboard();
    for (const a of agents) {
      kb.text(a.name.slice(0, 30), `agsel:${a.id}`).row();
    }
    kb.text("« Назад к чату", `cdm:${dialogId}`).row();
    const t = "Выберите агента для этого чата:";
    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(t, { reply_markup: kb });
    } else {
      await ctx.reply(t, { reply_markup: kb });
    }
  });

  privateOnly.callbackQuery(/^cdm:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showDialogChatPanel(ctx, ctx.match![1]);
  });

  privateOnly.callbackQuery(/^agsel:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const agentId = ctx.match![1];
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    const meta = await getDialogMeta(uid);
    const did = meta.chatPickDialogId;
    if (!did) {
      await ctx.reply("Сессия устарела. Откройте **Режим чатов** снова.");
      return;
    }
    try {
      await setDialogAgent(appUserId, agentId, did);
    } catch (e) {
      await ctx.reply(e instanceof Error ? e.message : "Ошибка");
      return;
    }
    await setDialogMeta(uid, { chatPickDialogId: undefined });
    await ctx.reply("Агент назначен.");
    await showDialogChatPanel(ctx, did);
  });

  privateOnly.callbackQuery(/^rem:ok:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Отмечено" });
    const id = ctx.match![1];
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    const r = await prisma.reminder.findFirst({ where: { id, appUserId } });
    if (!r) return;
    await prisma.reminder.update({
      where: { id },
      data: { status: "completed", webSentAt: r.webSentAt ?? new Date() },
    });
  });

  privateOnly.callbackQuery(/^rem:zz:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Отложено" });
    const id = ctx.match![1];
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    const r = await prisma.reminder.findFirst({
      where: { id, appUserId, status: "awaiting_confirm" },
    });
    if (!r) return;
    const snoozeMs =
      Math.min(24 * 60, Math.max(1, Number(process.env.REMINDER_SNOOZE_MINUTES) || 60)) * 60 * 1000;
    await prisma.reminder.update({
      where: { id },
      data: {
        status: "pending",
        fireAt: new Date(Date.now() + snoozeMs),
        requiresBotAck: true,
      },
    });
  });

  /** Отключить агента после отчёта о выполненных шагах (см. agentInboundReport). */
  privateOnly.callbackQuery(/^agr:dis:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Агент отключён" });
    const agentId = ctx.match![1];
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    try {
      await updateProductAgent(appUserId, agentId, { enabled: false });
    } catch (e) {
      await ctx.reply(e instanceof Error ? e.message : "Ошибка");
    }
  });

  privateOnly.callbackQuery("agr:later", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Ок" });
  });

  /** Закрыть все открытые Task для appUserId (кнопка после отчёта агента). */
  privateOnly.callbackQuery("agr:tsk", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Задачи закрыты" });
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    const r = await prisma.task.updateMany({
      where: { appUserId, status: "open" },
      data: { status: "done" },
    });
    await ctx.reply(`Открытых задач закрыто: ${r.count}.`);
  });

  privateOnly.callbackQuery(/^pol:g:([01])$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const acc = await getAccountForTelegramUser(uid);
    if (!acc) return;
    await patchPolicyFromBot(acc.accountId, { autoInGroups: ctx.match![1] === "1" });
    await showAgentSettingsPanel(ctx, true);
  });

  privateOnly.callbackQuery(/^pol:c:(all|allowlist)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const scope = ctx.match![1] as AgentScope;
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const acc = await getAccountForTelegramUser(uid);
    if (!acc) return;
    await patchPolicyFromBot(acc.accountId, { agentScope: scope });
    await showAgentSettingsPanel(ctx, true);
  });

  privateOnly.callbackQuery(/^pol:panel$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showAgentSettingsPanel(ctx, true);
  });

  privateOnly.callbackQuery(/^pag:main$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showAgentsHub(ctx, true);
  });

  privateOnly.callbackQuery(/^pag:add$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    if (await replyIfAgentFlowsNeedMtproto(ctx, appUserId)) return;
    await setDialogMeta(uid, { step: "agent_create_name" });
    await ctx.reply("Введите **имя** нового агента (одним сообщением, до 120 символов).", {
      parse_mode: "Markdown",
      reply_markup: mainMenu(),
    });
  });

  privateOnly.callbackQuery(/^pag:v:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showAgentCard(ctx, ctx.match![1]);
  });

  privateOnly.callbackQuery(/^pag:prm:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    await setDialogMeta(uid, { step: "agent_edit_prompt", agentEditId: ctx.match![1] });
    await ctx.reply("Отправьте новый текст **инструкций** для агента (одним сообщением).", {
      parse_mode: "Markdown",
    });
  });

  privateOnly.callbackQuery(/^pag:def:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    await updateProductAgent(appUserId, ctx.match![1], { isDefault: true });
    await showAgentCard(ctx, ctx.match![1]);
  });

  privateOnly.callbackQuery(/^pag:en:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    const cur = await prisma.productAgent.findFirst({ where: { id: ctx.match![1], appUserId } });
    if (!cur) return;
    await updateProductAgent(appUserId, cur.id, { enabled: !cur.enabled });
    await showAgentCard(ctx, cur.id);
  });

  privateOnly.callbackQuery(/^pag:del:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    await deleteProductAgent(appUserId, ctx.match![1]);
    await showAgentsHub(ctx, true);
  });

  privateOnly.callbackQuery(/^pag:asgn:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const acc = await getAccountForTelegramUser(uid);
    if (!acc) {
      await ctx.reply("Нет TgAccount.");
      return;
    }
    const aid = ctx.match![1];
    await setDialogMeta(uid, { assignAgentId: aid });
    await sendOrEditAssign(ctx, acc.accountId, 0, aid, Boolean(ctx.callbackQuery?.message));
  });

  privateOnly.callbackQuery(/^pag:noop$/, async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  privateOnly.callbackQuery(/^pda:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const page = parseInt(ctx.match![1], 10);
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const meta = await getDialogMeta(uid);
    const agentId = meta.assignAgentId;
    if (!agentId) return;
    const acc = await getAccountForTelegramUser(uid);
    if (!acc) return;
    await sendOrEditAssign(ctx, acc.accountId, page, agentId, true);
  });

  privateOnly.callbackQuery(/^pds:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    const meta = await getDialogMeta(uid);
    const agentId = meta.assignAgentId;
    if (!agentId) {
      await ctx.reply("Сессия назначения устарела. Откройте «Назначить чаты» снова.");
      return;
    }
    try {
      await setDialogAgent(appUserId, agentId, ctx.match![1]);
    } catch (e) {
      await ctx.reply(e instanceof Error ? e.message : "Ошибка");
      return;
    }
    await resetDialogFsm(uid);
    await showAgentCard(ctx, agentId);
  });

  privateOnly.callbackQuery(/^pad:noop$/, async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  privateOnly.callbackQuery(/^agl:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const page = parseInt(ctx.match![1], 10);
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const acc = await getAccountForTelegramUser(uid);
    if (!acc) return;
    const policy = await prisma.tgAccount.findUnique({ where: { id: acc.accountId } });
    if (!policy) return;
    const p = { ...defaultPolicy(), ...parsePolicy(policy.policyJson) };
    if (p.agentScope !== "allowlist") {
      await ctx.reply("Сначала выберите «Только список» в настройках автоответов.");
      return;
    }
    const edit = Boolean(ctx.callbackQuery?.message);
    await sendOrEditAllowlist(ctx, acc.accountId, page, edit);
  });

  privateOnly.callbackQuery(/^ag:t:(\d+):([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const page = parseInt(ctx.match![1], 10);
    const dialogId = ctx.match![2];
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const acc = await getAccountForTelegramUser(uid);
    if (!acc) return;
    const allowed = await getAllowedDialogIdSet(acc.accountId);
    await toggleAgentAllowedDialog(acc.accountId, dialogId, !allowed.has(dialogId));
    await sendOrEditAllowlist(ctx, acc.accountId, page, true);
  });

  privateOnly.callbackQuery(/^ag:noop$/, async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  privateOnly.callbackQuery(/^not:add$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    const lim = await assertCanAddNote(appUserId);
    if (!lim.ok) {
      await ctx.reply(lim.message, { parse_mode: "Markdown", reply_markup: mainMenu() });
      return;
    }
    await setDialogMeta(uid, { step: "note_body" });
    await ctx.reply("Напишите текст **заметки** одним сообщением.", { parse_mode: "Markdown" });
  });

  privateOnly.callbackQuery(/^not:rem$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    const lim = await assertCanAddReminder(appUserId);
    if (!lim.ok) {
      await ctx.reply(lim.message, { parse_mode: "Markdown", reply_markup: mainMenu() });
      return;
    }
    await setDialogMeta(uid, { step: "rem_1", rem: {} });
    await ctx.reply(
      [
        "**Заголовок** напоминания (коротко).",
        "",
        "Выйти без создания: **отмена** или **/cancel**.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  });

  privateOnly.callbackQuery(/^not:v:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    await prisma.userNote.deleteMany({ where: { id: ctx.match![1], appUserId } });
    await ctx.reply("Заметка удалена.");
    await showNotesHub(ctx, false);
  });

  privateOnly.callbackQuery(/^not:noop$/, async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  privateOnly.callbackQuery(/^not:rv:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    const id = ctx.match![1];
    const r = await prisma.reminder.findFirst({ where: { id, appUserId } });
    if (!r) {
      await ctx.reply("Напоминание не найдено.");
      return;
    }
    const kb = new InlineKeyboard()
      .text("Перенести (+мин)", `rem:sn:${id}`)
      .row()
      .text("Удалить", `rem:del:${id}`)
      .row();
    await ctx.reply(
      [
        `**${r.title}**`,
        "",
        r.text,
        "",
        `Когда: ${r.fireAt.toLocaleString("ru-RU")}`,
        "",
        `Статус: ${r.status}`,
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: kb },
    );
  });

  privateOnly.callbackQuery(/^rem:del:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Удалено" });
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    const id = ctx.match![1];
    await prisma.reminder.deleteMany({ where: { id, appUserId } });
    await ctx.reply("Напоминание удалено.");
    await showNotesHub(ctx, false);
  });

  privateOnly.callbackQuery(/^rem:sn:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    const id = ctx.match![1];
    const r = await prisma.reminder.findFirst({ where: { id, appUserId } });
    if (!r) {
      await ctx.reply("Напоминание не найдено.");
      return;
    }
    await setDialogMeta(uid, { step: "rem_reschedule", remRescheduleId: id });
    await ctx.reply("Введите **число минут** от сейчас, на которое перенести напоминание (например 120).", {
      parse_mode: "Markdown",
    });
  });

  privateOnly.callbackQuery(/^ctp:cancel$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    await resetDialogFsm(uid);
    await ctx.reply("Отменено.", { reply_markup: mainMenu() });
  });

  privateOnly.callbackQuery(/^ctp:(\d)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    if (await replyIfAgentFlowsNeedMtproto(ctx, appUserId)) return;
    const ix = parseInt(ctx.match![1], 10);
    const tpl = comradeTemplateFromPickIndex(ix);
    if (!tpl) {
      await ctx.reply("Неизвестный шаблон.");
      return;
    }
    const meta = await getDialogMeta(uid);
    await setDialogMeta(uid, {
      step: "comrade_title",
      comradeTemplateType: tpl,
      comradeDialogPickPage: 0,
      productChatHistory: meta.productChatHistory,
    });
    await ctx.reply(
      [
        `Шаблон: **${COMRADE_TEMPLATES[tpl].nameRu}**`,
        "",
        "Введите **краткое название задачи** одной строкой (видно только вам в списке).",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  });

  privateOnly.callbackQuery(/^crp:noop$/, async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  privateOnly.callbackQuery(/^crp:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const page = parseInt(ctx.match![1], 10);
    if (!Number.isFinite(page)) return;
    const meta = await getDialogMeta(uid);
    if (meta.step !== "comrade_pick_dialog") {
      await ctx.reply("Сессия устарела. Начните с **Агенты**.", { parse_mode: "Markdown", reply_markup: mainMenu() });
      return;
    }
    await setDialogMeta(uid, { comradeDialogPickPage: page, productChatHistory: meta.productChatHistory });
    await showComradeDialogPick(ctx, page, true);
  });

  privateOnly.callbackQuery(/^ctd:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    const dialogId = ctx.match![1];
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    const acc = await getAccountForTelegramUser(uid);
    if (!acc) {
      await ctx.reply("Нужен **/connect**.", { parse_mode: "Markdown", reply_markup: mainMenu() });
      return;
    }
    const meta = await getDialogMeta(uid);
    const tpl = meta.comradeTemplateType;
    const title = meta.comradeTitleDraft?.trim();
    if (!tpl || !title) {
      await ctx.reply("Сессия устарела. Откройте **Агенты** снова.", { reply_markup: mainMenu() });
      return;
    }
    const dlg = await prisma.tgDialog.findFirst({
      where: { id: dialogId, accountId: acc.accountId },
    });
    if (!dlg) {
      await ctx.reply("Чат не найден.");
      return;
    }
    const objective = (meta.comradeObjectiveDraft || "").trim();
    const peerLabel = (dlg.title || dlg.peerKey || "").trim().slice(0, 120);
    const { text: body, usedPolish } = await composeComradeFirstMessageToPeer(tpl, title, objective, peerLabel);
    const task = await dbComradeTask.create({
      data: {
        appUserId,
        title: title.slice(0, 500),
        objective: objective.slice(0, 4000),
        templateType: tpl,
        linkedChatId: dialogId,
        status: "WAITING_CONFIRMATION",
        nextActionAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    await setDialogMeta(uid, {
      step: "out_confirm",
      outboundDraft: { dialogId, text: body, comradeTaskId: task.id },
      comradeOutboundTaskId: task.id,
      comradeTemplateType: undefined,
      comradeTitleDraft: undefined,
      comradeObjectiveDraft: undefined,
      comradeDialogPickPage: undefined,
      outPickDialogId: undefined,
      productChatHistory: meta.productChatHistory,
    });
    await ctx.reply(
      usedPolish
        ? "Текст для контакта **переформулирован** в короткое живое сообщение (не копируем инструкции боту). Ничего не уйдёт без **Отправить** — при необходимости отредактируйте вручную перед отправкой."
        : "Текст для контакта (ничего не уйдёт без **Отправить**). Если выглядит как сырое задание — включите LLM в `.env` или задайте `PRODUCT_BOT_COMRADE_POLISH` не `0`.",
      { parse_mode: "Markdown" },
    );
    await ctx.reply(body.slice(0, 3500), { reply_markup: outboundConfirmKeyboard() });
  });

  privateOnly.callbackQuery(/^mvp:db:root$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showComradeTaskDashboardRoot(ctx, true);
  });

  privateOnly.callbackQuery(/^mvp:db:([awnod])$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const code = ctx.match![1];
    const map: Record<string, TaskDashboardBucket> = {
      a: "active",
      w: "waiting_reply",
      n: "needs_action",
      o: "overdue",
      d: "done",
    };
    const bucket = map[code];
    if (!bucket) return;
    await showComradeTaskDashboardBucket(ctx, bucket, true);
  });

  privateOnly.callbackQuery(/^cr:c:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Закрыто" });
    const uid = ctx.from?.id;
    const id = ctx.match![1];
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    await dbComradeTask.updateMany({
      where: { id, appUserId },
      data: { status: "CLOSED" },
    });
  });

  privateOnly.callbackQuery(/^cr:g:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Отмечено" });
    const uid = ctx.from?.id;
    const id = ctx.match![1];
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    await dbComradeTask.updateMany({
      where: { id, appUserId },
      data: { status: "GOAL_ACHIEVED" },
    });
  });

  privateOnly.callbackQuery(/^cr:z:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Ок" });
    const uid = ctx.from?.id;
    const id = ctx.match![1];
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    const next = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await dbComradeTask.updateMany({
      where: { id, appUserId },
      data: { status: "FOLLOWUP_DUE", nextActionAt: next },
    });
  });

  privateOnly.callbackQuery(/^cr:p:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Пауза" });
    const uid = ctx.from?.id;
    const id = ctx.match![1];
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    await dbComradeTask.updateMany({
      where: { id, appUserId },
      data: { status: "PAUSED" },
    });
  });

  privateOnly.callbackQuery(/^cr:r:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    const id = ctx.match![1];
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    const acc = await getAccountForTelegramUser(uid);
    const task = await dbComradeTask.findFirst({ where: { id, appUserId } });
    if (!task?.linkedChatId) {
      await ctx.reply("У задачи нет привязанного чата.");
      return;
    }
    if (!acc) {
      await ctx.reply("Нужен подключённый Telegram (**/connect**).", { parse_mode: "Markdown" });
      return;
    }
    const meta = await getDialogMeta(uid);
    await setDialogMeta(uid, {
      step: "out_1",
      outPickDialogId: task.linkedChatId,
      comradeOutboundTaskId: task.id,
      productChatHistory: meta.productChatHistory,
    });
    await ctx.reply(
      "Введите текст **ответа контакту**. Затем подтвердите **Отправить** / **Изменить** / **Отмена**.",
      { parse_mode: "Markdown" },
    );
  });

  /** Comrade: предложить встречу (уточнить время) — черновик исходящего с подтверждением */
  privateOnly.callbackQuery(/^cr:m:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    const id = ctx.match![1];
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    const acc = await getAccountForTelegramUser(uid);
    const task = await dbComradeTask.findFirst({ where: { id, appUserId } });
    if (!task?.linkedChatId) {
      await ctx.reply("У задачи нет привязанного чата.");
      return;
    }
    if (!acc) {
      await ctx.reply("Нужен подключённый Telegram (**/connect**).", { parse_mode: "Markdown" });
      return;
    }
    const dlg = await prisma.tgDialog.findFirst({
      where: { id: task.linkedChatId, accountId: acc.accountId },
      select: { title: true, peerKey: true },
    });
    const peerLabel = (dlg?.title || dlg?.peerKey || "контакт").slice(0, 120);
    const body = await composeMeetingDraftToPeer({
      dialogId: task.linkedChatId,
      peerLabel,
      taskTitle: task.title || "",
      taskObjective: task.objective || "",
    });

    const meta = await getDialogMeta(uid);
    await setDialogMeta(uid, {
      step: "out_confirm",
      outboundDraft: { dialogId: task.linkedChatId, text: body, comradeTaskId: task.id },
      comradeOutboundTaskId: task.id,
      productChatHistory: meta.productChatHistory,
    });
    await ctx.reply("Черновик сообщения для назначения встречи (ничего не уйдёт без **Отправить**):", {
      parse_mode: "Markdown",
      reply_markup: mainMenu(),
    });
    await ctx.reply(body.slice(0, 3500), { reply_markup: outboundConfirmKeyboard() });
  });

  privateOnly.callbackQuery(/^agm:templates$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await replyComradeTemplatePicker(ctx);
  });

  privateOnly.callbackQuery(/^agm:dash$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showComradeTaskDashboardRoot(ctx, false);
  });

  privateOnly.callbackQuery(/^agm:named$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showAgentsHub(ctx, false);
  });

  privateOnly.callbackQuery(/^crs:next$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const meta = await getDialogMeta(uid);
    const next = (meta.courseStep ?? 0) + 1;
    await sendProductCourseStep(ctx, uid, next, true);
  });

  privateOnly.callbackQuery(/^crs:done$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const meta = await getDialogMeta(uid);
    await setDialogMeta(uid, {
      courseDone: true,
      courseStep: undefined,
      productChatHistory: meta.productChatHistory,
    });
    if (ctx.callbackQuery?.message) {
      const m = ctx.callbackQuery.message;
      try {
        if (m.photo) {
          await ctx.editMessageCaption({
            caption:
              "✅ Обучение пройдено. Следующее сообщение — зачем подключать личный Telegram.",
            parse_mode: "Markdown",
          });
        } else {
          await ctx.editMessageText(
            "Отлично — базовый тур пройден. Ниже практический следующий шаг про личный Telegram.",
            { parse_mode: "Markdown" },
          );
        }
      } catch (e) {
        if (!isMessageNotModifiedError(e)) throw e;
      }
    }
    // Сначала регистрация (обязательная). После неё — объяснение про /connect и кнопка.
    if (!(await requireRegisteredOrExplain(ctx, uid))) return;
    await replyPostCourseConnectExplainer(ctx, { skipIllustration: true });
    await ctx.reply("Меню:", { reply_markup: mainMenu() });
  });

  privateOnly.callbackQuery(/^crs:why_connect$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await replyPostCourseConnectExplainer(ctx);
    await ctx.reply("Меню:", { reply_markup: mainMenu() });
  });

  privateOnly.callbackQuery(/^crs:replay$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const meta = await getDialogMeta(uid);
    await setDialogMeta(uid, {
      courseDone: false,
      courseStep: 0,
      productChatHistory: meta.productChatHistory,
    });
    await sendProductCourseStep(ctx, uid, 0, Boolean(ctx.callbackQuery?.message));
  });

  /** Старт курса с приветственного /start (то же содержание, что «Обучение» с нуля). */
  privateOnly.callbackQuery(/^crs:begin$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const meta = await getDialogMeta(uid);
    await setDialogMeta(uid, {
      courseDone: false,
      courseStep: 0,
      productChatHistory: meta.productChatHistory,
    });
    await sendProductCourseStep(ctx, uid, 0, Boolean(ctx.callbackQuery?.message));
  });

  privateOnly.callbackQuery(/^st:hub$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showSettingsHub(ctx, true);
  });

  privateOnly.callbackQuery(/^st:cab$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const { appUserId } = await ensureBotBinding(uid);
    await ctx.reply(formatCabinetCard(appUserId), { parse_mode: "Markdown", reply_markup: mainMenu() });
  });

  privateOnly.callbackQuery(/^st:sec$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showAgentSettingsPanel(ctx, true);
  });

  privateOnly.callbackQuery(/^st:arc$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showComradeArchivePanel(ctx, true);
  });

  privateOnly.callbackQuery(/^st:conn$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await beginMtprotoConnectWizard(ctx);
  });

  privateOnly.callbackQuery(/^st:cht$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showChatsHub(ctx, 0, false);
  });

  privateOnly.callbackQuery(/^st:agnote$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const meta = await getDialogMeta(uid);
    const next = meta.allowAgentNotes !== true;
    await setDialogMeta(uid, { allowAgentNotes: next, productChatHistory: meta.productChatHistory });
    await showSettingsHub(ctx, true);
  });

  privateOnly.callbackQuery(/^st:agents$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showAgentsHub(ctx, false);
  });

  privateOnly.callbackQuery(/^menu:noop$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Меню:", { reply_markup: mainMenu() });
  });

  privateOnly.callbackQuery(/^nl:yes$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const meta = await getDialogMeta(uid);
    const p = meta.nlPending;
    if (meta.step !== "nl_confirm" || !p || p.t === "open_section") {
      await ctx.reply("Нет действия для подтверждения.", { reply_markup: mainMenu() });
      return;
    }
    await runNlExecuteAndClear(ctx, uid, p, meta.productChatHistory);
  });

  privateOnly.callbackQuery(/^nl:no$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const meta = await getDialogMeta(uid);
    await setDialogMeta(uid, {
      step: "idle",
      nlPending: undefined,
      nlPickChatIds: undefined,
      nlPickChatsPage: undefined,
      productChatHistory: meta.productChatHistory,
    });
    await ctx.reply("Отменено.", { reply_markup: mainMenu() });
  });

  privateOnly.callbackQuery(/^nl:pick:noop$/, async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  privateOnly.callbackQuery(/^nl:pick:next$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const meta = await getDialogMeta(uid);
    const p = meta.nlPending;
    if (meta.step !== "nl_pick_chats" || !p || !needsNlChatPick(p)) {
      await ctx.reply("Нет черновика для подтверждения.", { reply_markup: mainMenu() });
      return;
    }
    const { appUserId } = await ensureBotBinding(uid);
    const { dialogs } = await fetchDialogsForNlPick(uid, appUserId);
    const ids = meta.nlPickChatIds ?? [];
    const links = buildNlLinkTargetsFromIds(ids, dialogs);
    const merged = nlPendingWithLinkTargets(p, links);
    if (!isProductBotNlConfirmRequired()) {
      await runNlExecuteAndClear(
        ctx,
        uid,
        merged as Exclude<NlPendingPayload, { t: "open_section" }>,
        meta.productChatHistory,
      );
      return;
    }
    await setDialogMeta(uid, {
      step: "nl_confirm",
      nlPending: merged,
      nlPickChatIds: undefined,
      nlPickChatsPage: undefined,
      productChatHistory: meta.productChatHistory,
    });
    const summary = formatNlPendingSummary(merged).slice(0, 4090);
    try {
      await ctx.editMessageText(summary, { reply_markup: nlConfirmKeyboard() });
    } catch (e) {
      if (!isMessageNotModifiedError(e)) throw e;
    }
  });

  privateOnly.callbackQuery(/^nl:pick:t:([0-9a-f-]{36})$/, async (ctx) => {
    const uid = ctx.from?.id;
    const dialogId = ctx.match![1];
    if (uid === undefined) return;
    const meta = await getDialogMeta(uid);
    if (meta.step !== "nl_pick_chats" || !meta.nlPending) {
      await ctx.answerCallbackQuery({ text: "Сессия устарела." });
      return;
    }
    const cur = [...(meta.nlPickChatIds ?? [])];
    const ix = cur.indexOf(dialogId);
    if (ix >= 0) cur.splice(ix, 1);
    else cur.push(dialogId);
    await setDialogMeta(uid, { nlPickChatIds: cur, productChatHistory: meta.productChatHistory });
    const { appUserId } = await ensureBotBinding(uid);
    const { dialogs } = await fetchDialogsForNlPick(uid, appUserId);
    const page = meta.nlPickChatsPage ?? 0;
    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: buildNlPickChatsKeyboard(dialogs, cur, page),
      });
    } catch (e) {
      if (!isMessageNotModifiedError(e)) throw e;
    }
    await ctx.answerCallbackQuery();
  });

  privateOnly.callbackQuery(/^nl:pick:pg:(\d+)$/, async (ctx) => {
    const uid = ctx.from?.id;
    const page = parseInt(ctx.match![1], 10);
    if (uid === undefined || !Number.isFinite(page)) return;
    const meta = await getDialogMeta(uid);
    if (meta.step !== "nl_pick_chats" || !meta.nlPending) {
      await ctx.answerCallbackQuery({ text: "Сессия устарела." });
      return;
    }
    await setDialogMeta(uid, { nlPickChatsPage: page, productChatHistory: meta.productChatHistory });
    const { appUserId } = await ensureBotBinding(uid);
    const { dialogs } = await fetchDialogsForNlPick(uid, appUserId);
    const ids = meta.nlPickChatIds ?? [];
    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: buildNlPickChatsKeyboard(dialogs, ids, page),
      });
    } catch (e) {
      if (!isMessageNotModifiedError(e)) throw e;
    }
    await ctx.answerCallbackQuery();
  });

  privateOnly.callbackQuery(/^out:go:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const dialogId = ctx.match![1];
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const acc = await getAccountForTelegramUser(uid);
    if (!acc) {
      await ctx.reply(
        "Нужен подключённый личный Telegram (через **Личный кабинет**). Без него исходящие в чаты недоступны.",
        { reply_markup: mainMenu() },
      );
      return;
    }
    const dlg = await prisma.tgDialog.findFirst({
      where: { id: dialogId, accountId: acc.accountId },
    });
    if (!dlg) {
      await ctx.reply("Чат не найден.");
      return;
    }
    await setDialogMeta(uid, {
      step: "out_1",
      outPickDialogId: dialogId,
      productChatHistory: (await getDialogMeta(uid)).productChatHistory,
    });
    await ctx.reply(
      [
        `Чат: ${(dlg.title || dlg.peerKey).slice(0, 80)}`,
        "",
        "Введите текст сообщения — после подтверждения оно встанет в очередь; отправку с личного аккаунта выполнит **worker**, если он запущен.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  });

  privateOnly.callbackQuery(/^ob:yes$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const meta = await getDialogMeta(uid);
    const d = meta.outboundDraft;
    if (meta.step !== "out_confirm" || !d?.dialogId || !d.text) {
      await ctx.reply("Нет черновика для отправки.", { reply_markup: mainMenu() });
      return;
    }
    const { appUserId } = await ensureBotBinding(uid);
    const acc = await getAccountForTelegramUser(uid);
    if (!acc) {
      await ctx.reply("Аккаунт не подключён.", { reply_markup: mainMenu() });
      return;
    }
    const r = await enqueueUserAccountOutbound(appUserId, acc.accountId, d.dialogId, d.text);
    const tid = d.comradeTaskId ?? meta.comradeOutboundTaskId;
    if (r.ok && tid) {
      await dbComradeTask.updateMany({
        where: { id: tid, appUserId },
        data: {
          status: "WAITING_RESPONSE",
          nextActionAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
    }
    await setDialogMeta(uid, {
      step: "idle",
      outboundDraft: undefined,
      outPickDialogId: undefined,
      comradeOutboundTaskId: undefined,
      productChatHistory: meta.productChatHistory,
    });
    await ctx.reply(r.ok ? r.message : `Ошибка: ${r.message}`, { reply_markup: mainMenu() });
  });

  privateOnly.callbackQuery(/^ob:edit$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const meta = await getDialogMeta(uid);
    const d = meta.outboundDraft;
    if (meta.step !== "out_confirm" || !d?.dialogId) {
      await ctx.reply("Нет черновика для правки.", { reply_markup: mainMenu() });
      return;
    }
    await setDialogMeta(uid, {
      step: "out_1",
      outPickDialogId: d.dialogId,
      comradeOutboundTaskId: d.comradeTaskId ?? meta.comradeOutboundTaskId,
      outboundDraft: undefined,
      productChatHistory: meta.productChatHistory,
    });
    await ctx.reply("Введите **новый текст** сообщения для контакта.", { parse_mode: "Markdown" });
  });

  privateOnly.callbackQuery(/^ob:no$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const meta = await getDialogMeta(uid);
    const d = meta.outboundDraft;
    const { appUserId } = await ensureBotBinding(uid);
    const tid = d?.comradeTaskId ?? meta.comradeOutboundTaskId;
    if (tid) {
      await dbComradeTask.updateMany({
        where: { id: tid, appUserId },
        data: { status: "PAUSED" },
      });
    }
    await setDialogMeta(uid, {
      step: "idle",
      outboundDraft: undefined,
      outPickDialogId: undefined,
      comradeOutboundTaskId: undefined,
      productChatHistory: meta.productChatHistory,
    });
    await ctx.reply("Отправка отменена.", { reply_markup: mainMenu() });
  });

  /** Подтверждение черновика TgPendingSend (awaiting_confirm -> pending) */
  privateOnly.callbackQuery(/^ps:yes:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    await ensureBotBinding(uid);
    const acc = await getAccountForTelegramUser(uid);
    if (!acc) {
      await ctx.reply("Нужен **/connect**.", { parse_mode: "Markdown", reply_markup: mainMenu() });
      return;
    }
    const id = ctx.match![1];
    const row = await prisma.tgPendingSend.findUnique({ where: { id } });
    if (!row || row.accountId !== acc.accountId) {
      await ctx.reply("Черновик не найден или нет доступа.", { reply_markup: mainMenu() });
      return;
    }
    if (row.status !== "awaiting_confirm") {
      await ctx.reply("Этот черновик уже обработан.", { reply_markup: mainMenu() });
      return;
    }
    // Validate sending policy before releasing to the worker queue.
    const tg = await prisma.tgAccount.findUnique({ where: { id: acc.accountId } });
    if (tg) {
      const p = { ...defaultPolicy(), ...parsePolicy(tg.policyJson) };
      if (p.sendAllowed === false) {
        await ctx.reply("Отправка запрещена политикой аккаунта (sendAllowed=false).", { reply_markup: mainMenu() });
        return;
      }
    }
    await prisma.tgPendingSend.update({ where: { id }, data: { status: "pending", error: null } });
    await ctx.reply("Отправка подтверждена: сообщение в очереди (worker отправит).", { reply_markup: mainMenu() });
  });

  privateOnly.callbackQuery(/^ps:no:([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const acc = await getAccountForTelegramUser(uid);
    if (!acc) return;
    const id = ctx.match![1];
    const row = await prisma.tgPendingSend.findUnique({ where: { id } });
    if (!row || row.accountId !== acc.accountId) return;
    if (row.status === "awaiting_confirm") {
      await prisma.tgPendingSend.update({ where: { id }, data: { status: "cancelled", error: null } });
    }
    await ctx.reply("Отменено.", { reply_markup: mainMenu() });
  });

  privateOnly.callbackQuery(/^rm:yes$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const meta = await getDialogMeta(uid);
    const rem = meta.rem;
    if (
      meta.step !== "rem_confirm" ||
      !rem?.title ||
      rem.text === undefined ||
      rem.minutes === undefined
    ) {
      await ctx.reply("Нет данных напоминания.", { reply_markup: mainMenu() });
      return;
    }
    const { appUserId } = await ensureBotBinding(uid);
    const lim = await assertCanAddReminder(appUserId);
    if (!lim.ok) {
      await resetDialogFsm(uid);
      await ctx.reply(lim.message, { parse_mode: "Markdown", reply_markup: mainMenu() });
      return;
    }
    const acc = await prisma.tgAccount.findUnique({ where: { appUserId } });
    const fireAt = new Date(Date.now() + rem.minutes * 60 * 1000);
    await prisma.reminder.create({
      data: {
        appUserId,
        accountId: acc?.id ?? null,
        title: rem.title,
        text: rem.text || "",
        fireAt,
        notifyTelegram: true,
        notifyWeb: true,
        status: "pending",
      },
    });
    await resetDialogFsm(uid);
    await ctx.reply(`Напоминание запланировано на ${fireAt.toLocaleString("ru-RU")}.`, {
      reply_markup: mainMenu(),
    });
  });

  privateOnly.callbackQuery(/^rm:no$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    await resetDialogFsm(uid);
    await ctx.reply("Напоминание не создано.", { reply_markup: mainMenu() });
  });

  privateOnly.callbackQuery(/^ag:yes$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const meta = await getDialogMeta(uid);
    const name = meta.agentCreateDraft?.trim();
    if (meta.step !== "agent_confirm" || !name) {
      await ctx.reply("Нет черновика агента.", { reply_markup: mainMenu() });
      return;
    }
    const { appUserId } = await ensureBotBinding(uid);
    if (await replyIfAgentFlowsNeedMtproto(ctx, appUserId)) {
      await resetDialogFsm(uid);
      return;
    }
    try {
      await createProductAgent(appUserId, { name });
      await resetDialogFsm(uid);
      await ctx.reply(`Агент «${name}» создан. Откройте **Агенты** для инструкций и привязки к чатам.`, {
        parse_mode: "Markdown",
        reply_markup: mainMenu(),
      });
    } catch (e) {
      await ctx.reply(e instanceof Error ? e.message : "Ошибка", { reply_markup: mainMenu() });
    }
  });

  privateOnly.callbackQuery(/^ag:no$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const meta = await getDialogMeta(uid);
    await setDialogMeta(uid, {
      step: "idle",
      agentCreateDraft: undefined,
      productChatHistory: meta.productChatHistory,
    });
    await ctx.reply("Создание агента отменено.", { reply_markup: mainMenu() });
  });

  privateOnly.on("message:text", async (ctx) => {
    const uid = ctx.from?.id;
    if (uid === undefined) return;
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;

    await ensureBotBinding(uid);
    const meta0 = await getDialogMeta(uid);
    if (meta0.onboardingDone === false && !isActiveMtprotoWizard(meta0)) {
      await renderOnboarding(ctx, meta0.onboardingStep ?? 0, false);
      return;
    }

    let meta = await getDialogMeta(uid);

    // Свободный диалог: сброс только если ждём явных кнопок (подтверждение NL при PRODUCT_BOT_NL_CONFIRM=1, и т.д.)
    const nlAwaitingButtons =
      isProductBotNlConfirmRequired() && (meta.step === "nl_confirm" || meta.step === "nl_pick_chats");
    if (
      meta.step !== "mtproto_phone" &&
      meta.step !== "mtproto_code" &&
      meta.step !== "mtproto_2fa" &&
      (nlAwaitingButtons || meta.step === "rem_confirm" || meta.step === "agent_confirm")
    ) {
      await resetDialogFsm(uid);
      meta = await getDialogMeta(uid);
    }

    if (isPlaintextWizardCancel(text) && isReminderWizardStep(meta.step)) {
      await resetDialogFsm(uid);
      await ctx.reply("Мастер напоминания отменён. Дальше пишите в чат как обычно.", {
        reply_markup: mainMenu(),
      });
      return;
    }

    if (meta.step === "out_1" && meta.outPickDialogId) {
      const t = text.trim();
      if (!t) {
        await ctx.reply("Введите непустой текст сообщения.");
        return;
      }
      const draftComradeId = meta.comradeOutboundTaskId;
      await setDialogMeta(uid, {
        step: "out_confirm",
        outboundDraft: {
          dialogId: meta.outPickDialogId,
          text: t.slice(0, 4096),
          comradeTaskId: draftComradeId,
        },
        outPickDialogId: undefined,
        comradeOutboundTaskId: draftComradeId,
        productChatHistory: meta.productChatHistory,
      });
      await ctx.reply(
        ["Подтвердите отправку с вашего личного аккаунта:", "", t.slice(0, 3500)].join("\n"),
        { reply_markup: outboundConfirmKeyboard() },
      );
      return;
    }

    if (meta.step === "mtproto_phone") {
      let phone = text
        .replace(/\s/g, "")
        .replace(/\u00a0/g, "")
        .replace(/-/g, "")
        .replace(/[()]/g, "");
      if (/^8\d{10}$/.test(phone)) phone = `+7${phone.slice(1)}`;
      if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
        await ctx.reply("Введите номер: `+79991234567` или российский `89991234567`.", {
          parse_mode: "Markdown",
        });
        return;
      }
      const { appUserId } = await ensureBotBinding(uid);
      if (!(await needsTelegramMtprotoLogin(appUserId))) {
        await resetDialogFsm(uid);
        await ctx.reply(
          [
            "Личный Telegram **уже подключён** — код не нужен.",
            "",
            "Если список чатов пустой — это **не ошибка входа**; отдельно запустите **worker** (`telegram-user/scripts/start-worker.ps1`).",
          ].join("\n"),
          { parse_mode: "Markdown", reply_markup: mainMenu() },
        );
        return;
      }
      try {
        await mtprotoSendCode(appUserId, phone);
        await deleteUserMessageIfPossible(ctx);
        await setDialogMeta(uid, {
          step: "mtproto_code",
          mtprotoDraft: { phone },
          productChatHistory: meta.productChatHistory,
        });
        await ctx.reply(
          "Код отправлен в Telegram. **Следующим сообщением** пришлите только цифры кода (обычно 5).",
          { parse_mode: "Markdown" },
        );
      } catch (e) {
        await ctx.reply(e instanceof Error ? e.message : "Ошибка отправки кода", { reply_markup: mainMenu() });
      }
      return;
    }

    if (meta.step === "mtproto_code") {
      const code = text.replace(/\D/g, "");
      if (!/^\d{5,6}$/.test(code)) {
        await ctx.reply(
          "Введите код из Telegram: **5 или 6 цифр** (можно вставить строку с текстом — оставим только цифры).",
          { parse_mode: "Markdown" },
        );
        return;
      }
      const { appUserId } = await ensureBotBinding(uid);
      if (!(await needsTelegramMtprotoLogin(appUserId))) {
        await resetDialogFsm(uid);
        await setDialogMeta(uid, { onboardingDone: true });
        await ctx.reply(
          [
            "Личный Telegram **уже был подключён** — шаг с кодом отменён.",
            "",
            "Для синхронизации диалогов при необходимости запустите **worker** отдельно от бота.",
          ].join("\n"),
          { parse_mode: "Markdown", reply_markup: mainMenu() },
        );
        return;
      }
      try {
        const r2 = await mtprotoSignIn(appUserId, code);
        await deleteUserMessageIfPossible(ctx);
        if (r2.needPassword) {
          await setDialogMeta(uid, {
            step: "mtproto_2fa",
            productChatHistory: meta.productChatHistory,
          });
          await ctx.reply(
            "Введите **пароль двухфакторной защиты** Telegram одним сообщением (его видите только вы).",
            { parse_mode: "Markdown" },
          );
          return;
        }
        await resetDialogFsm(uid);
        await setDialogMeta(uid, { onboardingDone: true });
        await ctx.reply(
          [
            "**Готово** — личный Telegram подключён, сессия сохранена.",
            "",
            "Чтобы **список чатов** появился в боте, в другом терминале запустите **worker** на той же машине, что API (`telegram-user/scripts/start-worker.ps1`). Остальные разделы можно пользовать и без него.",
          ].join("\n"),
          { parse_mode: "Markdown", reply_markup: mainMenu() },
        );
      } catch (e) {
        await deleteUserMessageIfPossible(ctx);
        const raw = e instanceof Error ? e.message : "Ошибка входа";
        const hint = mtprotoSignInUserHint(raw);
        if (hint) {
          await setDialogMeta(uid, {
            step: "mtproto_phone",
            mtprotoDraft: undefined,
            productChatHistory: meta.productChatHistory,
          });
          await ctx.reply(hint, { parse_mode: "Markdown", reply_markup: mainMenu() });
        } else {
          await ctx.reply(raw, { reply_markup: mainMenu() });
        }
      }
      return;
    }

    if (meta.step === "mtproto_2fa") {
      const pwd = text.trim();
      if (!pwd) {
        await ctx.reply("Введите непустой пароль.");
        return;
      }
      const { appUserId } = await ensureBotBinding(uid);
      try {
        await mtprotoPassword(appUserId, pwd);
        await deleteUserMessageIfPossible(ctx);
        await resetDialogFsm(uid);
        await setDialogMeta(uid, { onboardingDone: true });
        await ctx.reply(
          [
            "**Готово** — личный Telegram подключён.",
            "",
            "Для **синхронизации диалогов** запустите **worker** отдельно (`telegram-user/scripts/start-worker.ps1`).",
          ].join("\n"),
          { parse_mode: "Markdown", reply_markup: mainMenu() },
        );
      } catch (e) {
        await deleteUserMessageIfPossible(ctx);
        await ctx.reply(e instanceof Error ? e.message : "Ошибка пароля", { reply_markup: mainMenu() });
      }
      return;
    }

    if (meta.step === "comrade_title" && meta.comradeTemplateType) {
      const title = text.trim();
      if (!title) {
        await ctx.reply("Введите непустое название.");
        return;
      }
      await setDialogMeta(uid, {
        step: "comrade_objective",
        comradeTitleDraft: title.slice(0, 500),
        productChatHistory: meta.productChatHistory,
      });
      await ctx.reply(
        "Опишите **цель и контекст** для контакта одним сообщением (подставим в черновик первого сообщения).",
        { parse_mode: "Markdown" },
      );
      return;
    }

    if (meta.step === "comrade_objective" && meta.comradeTemplateType && meta.comradeTitleDraft) {
      await setDialogMeta(uid, {
        step: "comrade_pick_dialog",
        comradeObjectiveDraft: text.trim().slice(0, 4000),
        comradeDialogPickPage: 0,
        productChatHistory: meta.productChatHistory,
      });
      await showComradeDialogPick(ctx, 0, false);
      return;
    }

    if (meta.step === "comrade_pick_dialog") {
      await ctx.reply("Выберите чат **кнопкой** в сообщении выше или откройте **Агенты** заново.", {
        parse_mode: "Markdown",
        reply_markup: mainMenu(),
      });
      return;
    }

    if (meta.step === "rem_reschedule" && meta.remRescheduleId) {
      const n = parseInt(text.replace(/\s/g, ""), 10);
      if (!Number.isFinite(n) || n < 1 || n > 10080) {
        await ctx.reply(
          "Введите целое число минут от 1 до 10080. Или **отмена** / **/cancel** — выйти из переноса.",
          { parse_mode: "Markdown" },
        );
        return;
      }
      const { appUserId } = await ensureBotBinding(uid);
      const id = meta.remRescheduleId;
      const fireAt = new Date(Date.now() + n * 60 * 1000);
      await prisma.reminder.updateMany({
        where: { id, appUserId },
        data: { fireAt, status: "pending", requiresBotAck: false },
      });
      await resetDialogFsm(uid);
      await ctx.reply(`Напоминание перенесено на ${fireAt.toLocaleString("ru-RU")}.`, {
        reply_markup: mainMenu(),
      });
      return;
    }

    if (meta.step === "note_body") {
      const { appUserId } = await ensureBotBinding(uid);
      const lim = await assertCanAddNote(appUserId);
      if (!lim.ok) {
        await resetDialogFsm(uid);
        await ctx.reply(lim.message, { parse_mode: "Markdown", reply_markup: mainMenu() });
        return;
      }
      await prisma.userNote.create({
        data: { appUserId, body: text.slice(0, 8000) },
      });
      await resetDialogFsm(uid);
      await ctx.reply("Заметка сохранена.", { reply_markup: mainMenu() });
      return;
    }

    if (meta.step === "agent_confirm") {
      await ctx.reply("Нажмите «Создать» или «Отмена».", {
        reply_markup: agentCreateConfirmKeyboard(),
      });
      return;
    }

    if (meta.step === "agent_create_name") {
      const name = text.trim().slice(0, 120);
      if (!name) {
        await ctx.reply("Введите непустое имя агента.");
        return;
      }
      const { appUserId } = await ensureBotBinding(uid);
      if (await replyIfAgentFlowsNeedMtproto(ctx, appUserId)) {
        await resetDialogFsm(uid);
        return;
      }
      await setDialogMeta(uid, {
        step: "agent_confirm",
        agentCreateDraft: name,
        productChatHistory: meta.productChatHistory,
      });
      await ctx.reply(`Создать агента «${name}»?`, {
        reply_markup: agentCreateConfirmKeyboard(),
      });
      return;
    }

    if (meta.step === "agent_edit_prompt" && meta.agentEditId) {
      const { appUserId } = await ensureBotBinding(uid);
      try {
        await updateProductAgent(appUserId, meta.agentEditId, { promptExtras: text });
        await resetDialogFsm(uid);
        await ctx.reply("Инструкции обновлены.", { reply_markup: mainMenu() });
      } catch (e) {
        await ctx.reply(e instanceof Error ? e.message : "Ошибка");
      }
      return;
    }

    if (meta.step === "rem_1") {
      await setDialogMeta(uid, {
        step: "rem_2",
        rem: { ...meta.rem, title: text.slice(0, 300) },
      });
      await ctx.reply("Текст напоминания (подробнее). Выйти: **отмена** или **/cancel**.", {
        parse_mode: "Markdown",
      });
      return;
    }

    if (meta.step === "rem_2") {
      await setDialogMeta(uid, {
        step: "rem_3",
        rem: { ...meta.rem, text: text.slice(0, 4000) },
      });
      await ctx.reply(
        [
          "Через сколько **минут** напомнить? (только число, например **60**).",
          "",
          "Выйти без напоминания: **отмена** или **/cancel**.",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
      return;
    }

    if (meta.step === "rem_3" && meta.rem?.title && meta.rem.text !== undefined) {
      const n = parseInt(text.replace(/\s/g, ""), 10);
      if (!Number.isFinite(n) || n < 1 || n > 10080) {
        await resetDialogFsm(uid);
        const fresh = await getDialogMeta(uid);
        await ctx.reply(
          [
            "Это был **мастер напоминания** (нужно было целое число минут). Мастер **закрыт** — отвечаю на ваше сообщение ниже.",
            "",
            "На будущее: **отмена** или **/cancel** — выход в любой момент.",
          ].join("\n"),
          { parse_mode: "Markdown", reply_markup: mainMenu() },
        );
        if (!isProductBotChatDisabled()) {
          try {
            const hist = fresh.productChatHistory ?? [];
            const { content, provider } = await runProductBotChatTurn(text, hist);
            const reply = content.trim().slice(0, 4096);
            if (reply) {
              const nextHist = appendProductChatTurn(hist, text, reply);
              await setDialogMeta(uid, {
                step: "idle",
                productChatHistory: nextHist,
              });
              await ctx.reply(reply, { reply_markup: mainMenu() });
              if (process.env.PRODUCT_BOT_CHAT_LOG === "1") {
                console.info(`[productBotChat] provider=${provider} len=${reply.length}`);
              }
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await ctx.reply(
              `Не удалось ответить (LLM). ${msg.slice(0, 400)}\nПроверьте OPENCLAW_* или OPENAI_* в .env.`,
              { reply_markup: mainMenu() },
            );
          }
        }
        return;
      }
      const fireAt = new Date(Date.now() + n * 60 * 1000);
      await setDialogMeta(uid, {
        step: "rem_confirm",
        rem: {
          title: meta.rem.title,
          text: meta.rem.text,
          minutes: n,
        },
        productChatHistory: meta.productChatHistory,
      });
      await ctx.reply(
        [
          "Подтвердите напоминание:",
          `Заголовок: ${meta.rem.title}`,
          `Текст: ${(meta.rem.text || "").slice(0, 500)}`,
          `Когда: ${fireAt.toLocaleString("ru-RU")}`,
        ].join("\n"),
        { reply_markup: remConfirmKeyboard() },
      );
      return;
    }

    if (meta.step === "rem_3") {
      await resetDialogFsm(uid);
      await ctx.reply(
        [
          "Мастер напоминания сброшен (не хватало данных шага).",
          "",
          "Заново: **Заметки** → **Напоминание**. Выйти из мастера: **отмена** или **/cancel**.",
        ].join("\n"),
        { parse_mode: "Markdown", reply_markup: mainMenu() },
      );
      return;
    }

    const freeChat =
      !meta.step || meta.step === "idle" || meta.step === "task_title" || meta.step === "add_chat_id";

    if (freeChat && !isProductBotChatDisabled()) {
      // Deterministic shortcuts: answer common “what do we have” questions with real data,
      // instead of letting the generic LLM chat suggest slash-commands.
      if (/^(какие|какой)\s+агент(ы|а)?\b|спис(о|а)к\s+агент(ы|а)?\b|^агент(ы|а)?\s+сейчас\b/i.test(text)) {
        await ensureBotBinding(uid);
        await showAgentsHub(ctx, false);
        return;
      }
      if (isProductBotNlEnabled()) {
        const { appUserId } = await ensureBotBinding(uid);
        const { dialogs, supplementText } = await fetchDialogsForNlPick(uid, appUserId);
        const agents = await prisma.productAgent.findMany({
          where: { appUserId },
          take: 40,
          select: { id: true, name: true },
        });
        const outcome = await parseProductBotNlOutcome(text, { dialogs, agents });

        if (outcome.kind === "user_message") {
          await ctx.reply(outcome.text.slice(0, 4096), { reply_markup: mainMenu() });
          return;
        }

        if (outcome.kind === "ok") {
          const p = outcome.payload;
          if (p.t === "open_section") {
            await runNlOpenSection(ctx, p.section);
            return;
          }
          if (p.t === "create_agent" || p.t === "task_agent_reminder") {
            if (await replyIfAgentFlowsNeedMtproto(ctx, appUserId)) return;
          }
          const confirmNl = isProductBotNlConfirmRequired();
          /** Всегда показываем выбор чатов для нового агента / задачи+напоминание — можно снять/добавить контакты даже если NL уже угадал часть. */
          const pickRequired = needsNlChatPick(p);

          if (pickRequired) {
            const ids = initialNlPickChatIds(p);
            const stripped = nlPendingStripLinkTargets(p);
            await setDialogMeta(uid, {
              step: "nl_pick_chats",
              nlPending: stripped,
              nlPickChatIds: ids,
              nlPickChatsPage: 0,
              productChatHistory: meta.productChatHistory,
            });
            const pickHint =
              ids.length > 0
                ? "\n\nЧасть чатов **уже отмечена** по запросу — снимите лишнее или добавьте другие, затем **«Далее»**."
                : "\n\nОтметьте **хотя бы один** чат, если нужна привязка агента (можно оставить пустым и назначить позже в **Агенты**).";
            await ctx.reply(formatNlPickChatsStepHeader(stripped) + supplementText + pickHint, {
              parse_mode: "Markdown",
              reply_markup: buildNlPickChatsKeyboard(dialogs, ids, 0),
            });
            return;
          }

          if (confirmNl) {
            await setDialogMeta(uid, {
              step: "nl_confirm",
              nlPending: p,
              productChatHistory: meta.productChatHistory,
            });
            await ctx.reply(formatNlPendingSummary(p).slice(0, 4090), {
              reply_markup: nlConfirmKeyboard(),
            });
            return;
          }

          await runNlExecuteAndClear(
            ctx,
            uid,
            p as Exclude<NlPendingPayload, { t: "open_section" }>,
            meta.productChatHistory,
          );
          return;
        }
        /* outcome.kind === "delegate_chat" — обычный диалог с LLM ниже */
      }

      try {
        const hist = meta.productChatHistory ?? [];
        const { content, provider } = await runProductBotChatTurn(text, hist);
        const reply = content.trim().slice(0, 4096);
        if (!reply) {
          await ctx.reply("Пустой ответ модели. Попробуйте ещё раз или /help.", { reply_markup: mainMenu() });
          return;
        }
        const nextHist = appendProductChatTurn(hist, text, reply);
        await setDialogMeta(uid, {
          step: "idle",
          productChatHistory: nextHist,
        });
        await ctx.reply(reply, { reply_markup: mainMenu() });
        if (process.env.PRODUCT_BOT_CHAT_LOG === "1") {
          console.info(`[productBotChat] provider=${provider} len=${reply.length}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await ctx.reply(
          `Не удалось получить ответ (LLM). ${msg.slice(0, 500)}\nПроверьте OPENCLAW_* или OPENAI_* в .env. Команды: /help`,
          { reply_markup: mainMenu() },
        );
      }
      return;
    }

    await ctx.reply(
      "Выберите раздел кнопками или команды: **/help**, **/register**, **/id**. Свободный текст здесь не обработан (включите LLM в `.env` или откройте пошаговый раздел).",
      { parse_mode: "Markdown", reply_markup: mainMenu() },
    );
  });

  return bot;
}

export function isProductBotConfigured(): boolean {
  return Boolean(process.env.PRODUCT_BOT_TOKEN?.trim());
}

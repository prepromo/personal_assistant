import { prisma } from "./prisma.js";
import { runChatCompletion, type ChatMsg } from "./llm/chatCompletion.js";
import type { AgentScope } from "./policy.js";
import { maybeAddDialogToAgentAllowlist, patchPolicyFromBot } from "./botAgentPolicy.js";
import { createProductAgent, deleteProductAgent, setDialogAgent, updateProductAgent } from "./productAgents.js";
import { enqueueUserAccountOutboundAwaitingConfirm } from "./productBotOutbound.js";
import { resolveNlOutboundTextForDialog } from "./composeNlOutboundToPeer.js";
import { needsTelegramMtprotoLogin } from "./mtprotoLoginService.js";

/** Агенты и задачи «агент + контакт» только после сохранённой MTProto-сессии (/connect). */
export const NL_AGENT_REQUIRES_MTPROTO_MESSAGE =
  "Сначала подключите личный Telegram: команда /connect → откройте веб-кабинет и в блоке «Личный Telegram» введите номер и код только на сайте. Без этого агент не создаётся.";

export type NlDialogLink = { dialogId: string; label: string };

export type NlPendingPayload =
  | {
      t: "create_agent";
      name: string;
      promptExtras: string;
      /** Привязка агента к чатам MTProto + опционально первое исходящее. */
      linkTargets?: NlDialogLink[];
      firstMessage?: string;
    }
  /** Одна пользовательская задача: черновик агента под неё + напоминание (см. промпт NL_SCHEMA). */
  | {
      t: "task_agent_reminder";
      name: string;
      promptExtras: string;
      title: string;
      text: string;
      minutes: number;
      linkTargets?: NlDialogLink[];
      firstMessage?: string;
    }
  | { t: "add_reminder"; title: string; text: string; minutes: number }
  | { t: "open_section"; section: "agents" | "notes" | "chats" }
  | {
      t: "policy_patch";
      agentScope?: AgentScope;
      autoInGroups?: boolean;
    }
  | { t: "delete_agent"; agentId: string; name: string }
  | { t: "set_default_agent"; agentId: string; name: string }
  | { t: "assign_agent_to_dialog"; agentId: string; agentName: string; dialogId: string; label: string }
  | { t: "add_note"; body: string };

export type NlDialogRef = { id: string; title: string | null; peerKey: string };

/** Собрать привязки из выбранных в боте id (после шага nl_pick_chats). */
export function buildNlLinkTargetsFromIds(ids: string[], dialogs: NlDialogRef[]): NlDialogLink[] {
  const map = new Map(dialogs.map((d) => [d.id, d]));
  return ids
    .filter((id) => map.has(id))
    .map((id) => {
      const d = map.get(id)!;
      return { dialogId: id, label: (d.title || d.peerKey).slice(0, 120) };
    });
}

export type NlAgentRef = { id: string; name: string };

/** Контекст классификатора: диалоги MTProto и существующие агенты (id + имя). */
export type NlParseContext = { dialogs: NlDialogRef[]; agents: NlAgentRef[] };

/** По умолчанию включено: иначе свободный чат только «болтает» и не создаёт агентов/напоминания. Отключить: PRODUCT_BOT_NL=0 */
export function isProductBotNlEnabled(): boolean {
  const v = process.env.PRODUCT_BOT_NL?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  return true;
}

/** Если true — после NL показываются кнопки «Подтвердить» / шаг выбора чатов как раньше. По умолчанию false: задачи из чата выполняются сразу. */
export function isProductBotNlConfirmRequired(): boolean {
  const v = process.env.PRODUCT_BOT_NL_CONFIRM?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function nlOptions() {
  const maxTokens = Math.min(
    1024,
    Math.max(128, Number(process.env.PRODUCT_BOT_NL_MAX_TOKENS) || 512),
  );
  const temperature = Math.min(0.5, Math.max(0, Number(process.env.PRODUCT_BOT_NL_TEMPERATURE) || 0.1));
  return { maxTokens, temperature };
}

function stripJsonFence(s: string): string {
  let t = s.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return t.trim();
}

/** Модель часто добавляет текст до/после JSON — вытаскиваем первый объект {...}. */
function tryParseNlJson(raw: string): Record<string, unknown> | null {
  const stripped = stripJsonFence(raw);
  try {
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    const start = stripped.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < stripped.length; i++) {
      const c = stripped[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(stripped.slice(start, i + 1)) as Record<string, unknown>;
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}

function resolveDialogByHint(
  hint: string,
  dialogs: NlDialogRef[],
): { id: string; label: string } | null {
  const h = hint
    .trim()
    .toLowerCase()
    .replace(/^["«»]+|["«»]+$/g, "")
    .replace(/[.,;:!?…]+$/u, "");
  if (!h) return null;
  for (const d of dialogs) {
    const t = (d.title || "").trim().toLowerCase();
    const pk = (d.peerKey || "").trim().toLowerCase();
    if (t && (t === h || t.includes(h) || h.includes(t.slice(0, Math.min(24, t.length))))) {
      return { id: d.id, label: d.title || d.peerKey };
    }
    if (pk && h.length >= 4 && pk.includes(h)) {
      return { id: d.id, label: d.title || d.peerKey };
    }
    if (t && h.length >= 2 && h.length <= 16) {
      const titleWords = t.split(/[\s_\-,.]+/).filter(Boolean);
      for (const tw of titleWords) {
        if (
          tw.length >= 2 &&
          (tw.startsWith(h) || tw.includes(h) || h.startsWith(tw.slice(0, Math.min(5, tw.length))))
        ) {
          return { id: d.id, label: d.title || d.peerKey };
        }
      }
    }
  }
  const words = h.split(/\s+/).filter((w) => w.length >= 2);
  for (const d of dialogs) {
    const t = (d.title || "").toLowerCase();
    for (const w of words) {
      if (w.length >= 2 && t.includes(w)) {
        return { id: d.id, label: d.title || d.peerKey };
      }
    }
  }
  /** Короткое имя/ник: слово в названии начинается с подсказки (напр. «Кам» → «Камил …»). */
  if (h.length >= 2 && h.length <= 16) {
    for (const d of dialogs) {
      const t = (d.title || "").toLowerCase();
      const tokens = t.split(/[\s·•,._\-]+/).filter((x) => x.length >= 2);
      for (const tok of tokens) {
        if (tok.startsWith(h) || (h.length >= 3 && tok.includes(h))) {
          return { id: d.id, label: d.title || d.peerKey };
        }
      }
    }
  }
  return null;
}

/**
 * Делит текст первого исходящего: короткая реплика для очереди и «хвост» в инструкции агента.
 * Правила: первая строка (если ниже есть текст); « … — если/когда/…»; первое предложение; иначе обрезка ~280 симв.
 */
export function splitFirstOutboundMessage(raw: string): { first: string; rest: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { first: "", rest: "" };

  const nl = trimmed.indexOf("\n");
  if (nl > 0) {
    const firstLine = trimmed.slice(0, nl).trim();
    const rest = trimmed.slice(nl + 1).trim();
    if (firstLine.length >= 2 && rest.length > 8) {
      return { first: firstLine, rest };
    }
  }

  const emRe = /\s+[—–]\s+(?=если|когда|после|при\s|для\s|тогда|а\s|чтобы\s)/i;
  const em = emRe.exec(trimmed);
  if (em && em.index >= 6) {
    return {
      first: trimmed.slice(0, em.index).trim(),
      rest: trimmed.slice(em.index).replace(/^\s+[—–]\s+/, "").trim(),
    };
  }

  const hyRe = /\s+-\s+(?=если|когда|после|при\s|для\s|тогда|чтобы\s)/i;
  const hy = hyRe.exec(trimmed);
  if (hy && hy.index >= 6) {
    return {
      first: trimmed.slice(0, hy.index).trim(),
      rest: trimmed.slice(hy.index).replace(/^\s+-\s+/, "").trim(),
    };
  }

  const sent = trimmed.match(/^(.{5,2000}?[.!?])(\s+)/s);
  if (sent && sent[1].length < trimmed.length - 12) {
    const rest = trimmed.slice(sent[0].length).trim();
    if (rest.length > 12) return { first: sent[1].trim(), rest };
  }

  if (trimmed.length > 280) {
    return {
      first: `${trimmed.slice(0, 277).trim()}…`,
      rest: trimmed.slice(277).trim(),
    };
  }
  return { first: trimmed, rest: "" };
}

/** Убирает из полного сообщения пользователя блок с явным первым исходящим (чтобы не дублировать в agent_prompt). */
function stripFirstMessageCueBlock(userText: string): string {
  let s = userText.trim();
  const cuts: RegExp[] = [
    /напиши(?:\s+им)?\s+первым\s*:\s*[\s\S]+$/im,
    /отправь(?:\s+им)?\s+первым\s*:\s*[\s\S]+$/im,
    /напиши\s+(?:ему|ей)\s*:\s*[\s\S]+$/im,
    /отправь\s+(?:ему|ей)\s*:\s*[\s\S]+$/im,
    /напиши\s+пользователю\s+[^\s,.;:]+(?:\s*:\s*|\s+и\s+)[\s\S]+$/im,
    /отправь\s+пользователю\s+[^\s,.;:]+(?:\s*:\s*|\s+и\s+)[\s\S]+$/im,
  ];
  for (const re of cuts) {
    s = s.replace(re, "").trim();
  }
  return s;
}

/** Текст для очереди первого сообщения, если в запросе не было «напиши … первым: …». */
function extractRawAfterFirstMessageCue(userText: string): string {
  const t = userText.trim();
  if (!t) return "";

  const tries: RegExp[] = [
    /напиши(?:\s+им)?\s+первым\s*:\s*([\s\S]+)/i,
    /отправь(?:\s+им)?\s+первым\s*:\s*([\s\S]+)/i,
    /напиши\s+(?:ему|ей)\s*:\s*([\s\S]+)/i,
    /отправь\s+(?:ему|ей)\s*:\s*([\s\S]+)/i,
    // «напиши пользователю Кам и попроси…» / «напиши пользователю Кам: …»
    /напиши\s+пользователю\s+[^\s,.;:]+(?:\s*:\s*|\s+и\s+)([\s\S]+)/i,
    /отправь\s+пользователю\s+[^\s,.;:]+(?:\s*:\s*|\s+и\s+)([\s\S]+)/i,
  ];
  for (const re of tries) {
    const m = t.match(re);
    if (m?.[1]?.trim()) return m[1].trim().slice(0, 4096);
  }
  return "";
}

function resolveAgentByHint(hint: string, agents: NlAgentRef[]): NlAgentRef | null {
  const h = hint.trim().toLowerCase().replace(/^["«»]+|["«»]+$/g, "");
  if (!h || !agents.length) return null;
  for (const a of agents) {
    const n = a.name.trim().toLowerCase();
    if (n === h || n.includes(h) || h.includes(n)) return a;
  }
  return null;
}

/** Несколько подсказок: массив строк или одна строка с запятыми / «А и Б». */
function collectHintStrings(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    const s = raw.trim();
    const parts = s.split(/[,;]|(?:\s+и\s+)|(?:\s+and\s+)/i).map((p) => p.trim()).filter(Boolean);
    return parts.length ? parts : [s];
  }
  return [];
}

function resolveDialogHintsToTargets(
  dialogHintsRaw: unknown,
  dialogHintSingle: unknown,
  dialogs: NlDialogRef[],
): NlDialogLink[] {
  const hints = [...collectHintStrings(dialogHintsRaw), ...collectHintStrings(dialogHintSingle)];
  const seen = new Set<string>();
  const out: NlDialogLink[] = [];
  for (const h of hints) {
    const r = resolveDialogByHint(h, dialogs);
    if (r && !seen.has(r.id)) {
      seen.add(r.id);
      out.push({ dialogId: r.id, label: r.label });
    }
  }
  return out;
}

function mergeUniqueLinks(a: NlDialogLink[] | undefined, b: NlDialogLink[]): NlDialogLink[] {
  const seen = new Set<string>();
  const out: NlDialogLink[] = [];
  for (const x of [...(a ?? []), ...b]) {
    if (!seen.has(x.dialogId)) {
      seen.add(x.dialogId);
      out.push(x);
    }
  }
  return out;
}

/**
 * Дополняет JSON классификатора: «чатах с …», «для чатов с …» из текста пользователя.
 */
function inferLinkTargetsFromUserMessage(userText: string, dialogs: NlDialogRef[]): NlDialogLink[] {
  if (!dialogs.length) return [];
  const seen = new Set<string>();
  const out: NlDialogLink[] = [];
  const pushChunk = (raw: string) => {
    for (const segment of raw.split(/(?:\s+и\s+|\s*,\s*)/i)) {
      const s = segment.replace(/^["«»\s]+|["«»\s]+$/g, "").trim();
      if (s.length < 1) continue;
      const r = resolveDialogByHint(s, dialogs);
      if (r && !seen.has(r.id)) {
        seen.add(r.id);
        out.push({ dialogId: r.id, label: r.label });
      }
    }
  };

  const blockStop = /(?:напиши|отправь)(?:\s+им)?\s+первым\s*:/i;
  const head = userText.split(blockStop)[0] ?? userText;

  /** Остановка имени до «, напиши» / « напиши» / тире — иначе в хвост попадает запятая или «напиши им первым». */
  const hintStop = String.raw`(?=\s*—|,\s*напиши|\s+напиши|\s*напиши|\s*отправь|$)`;
  const patterns = [
    new RegExp(String.raw`чат(?:ах|ов|а|ы)?\s+с\s+([^:;\n]+?)${hintStop}`, "gi"),
    new RegExp(String.raw`контакт(?:ах|ов|а|ы)?\s+с\s+([^:;\n]+?)${hintStop}`, "gi"),
    new RegExp(String.raw`для\s+чат(?:ах|ов|а|ы)?\s+с\s+([^:;\n]+?)${hintStop}`, "gi"),
    /** «напиши пользователю Кам …» — имя одним токеном (без \\b: в JS он не работает с кириллицей). */
    /пользовател(?:ю|я)\s+([^\s,.;:]+)/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(head)) !== null) {
      pushChunk(m[1]);
    }
  }
  return out;
}

/** Только короткая первая реплика для очереди (хвост уходит в инструкции через split). */
export function extractFirstMessageFromUserText(userText: string): string | undefined {
  const raw = extractRawAfterFirstMessageCue(userText);
  if (!raw) return undefined;
  const { first } = splitFirstOutboundMessage(raw);
  return first || undefined;
}

const NL_SCHEMA = [
  "Ответь ТОЛЬКО одним JSON-объектом (без markdown и пояснений). Поля:",
  '{ "intent": "none" | "create_agent" | "task_agent_reminder" | "add_reminder" | "open_section" | "policy_patch" | "delete_agent" | "set_default_agent" | "assign_agent_to_dialog" | "add_note",',
  '  "agent_name": string (для create_agent, task_agent_reminder, delete_agent, set_default_agent),',
  '  "agent_prompt": string (краткие инструкции агента; для task_agent_reminder — как вести переписку под задачу пользователя),',
  '  "dialog_hint": string (один чат: фрагмент названия из списка; для assign_agent_to_dialog — чат, куда назначить агента),',
  '  "agent_hint": string (для assign_agent_to_dialog — существующий агент по имени из списка),',
  '  "dialog_hints": string[] (несколько чатов для привязки нового агента — фрагменты имён из списка диалогов; опционально),',
  '  "first_message": string (опционально: короткое первое сообщение в чат; длинные условия — в agent_prompt; сервер отрежет хвост после « — если/когда…» в отдельную часть инструкций),',
  '  "agent_scope": "all" | "allowlist" (только для policy_patch — область действия агента),',
  '  "auto_in_groups": boolean (только для policy_patch — автоответы в группах/каналах),',
  '  "reminder_title": string, "reminder_text": string, "minutes": number (для add_reminder и task_agent_reminder),',
  '  "note_body": string (для add_note — текст заметки),',
  '  "section": "agents" | "notes" | "chats" (для open_section)',
  "}",
  'intent "none" — если пользователь просто болтает, просит объяснить, или запрос не про действия в приложении.',
  'intent "task_agent_reminder" — пользователь сформулировал ЗАДАЧУ, для которой нужны ОБА: (1) отдельный агент с инструкциями под эту задачу, (2) напоминание выполнить её или следующий шаг.',
  "Примеры task_agent_reminder: «написать друзьям и согласовать встречу», «напомни подготовить презентацию и отвечай в чате кратко», «следи за перепиской с заказчиком и напомни завтра созвониться».",
  "Для task_agent_reminder: agent_name — короткое имя агента по смыслу задачи (например «Друзья и встречи»); agent_prompt — полные инструкции (весь смысл из сообщения пользователя, до 8000 символов); reminder_title — короткий заголовок напоминания; reminder_text — что сделать; minutes — через сколько минут напомнить (если пользователь не сказал срок — разумная оценка: вечером сегодня ≈ 180–240, завтра утром ≈ 720–900, «скоро» ≈ 60–120).",
  "Для create_agent: всегда задай короткий agent_name по смыслу (например «Диплом», «Кам»), даже если пользователь не назвал явно. agent_prompt — ВСЯ политика и условия из сообщения (длинные требования — целиком в agent_prompt).",
  "Если пользователь просит создать агента для конкретных контактов/чатов — заполни dialog_hints (или dialog_hint) по списку диалогов ниже.",
  "Если пользователь хочет первое сообщение контакту — заполни first_message; после выполнения NL сервер по умолчанию **полирует текст через LLM** и ставит в **очередь отправки** (TgPendingSend) для привязанных чатов — отправляет **worker** с личного аккаунта. Отключить автоочередь: PRODUCT_BOT_NL_AUTO_OUTBOUND=0.",
  "При фразах «напиши им первым», «напиши пользователю …» — first_message + при необходимости agent_prompt как стиль после первого сообщения.",
  'Не путай с add_reminder: если нужен только напоминание без нового агента — intent add_reminder. Если только агент без напоминания — create_agent.',
  "Фразы «чатах с …», «для чатов с …» из текста пользователя сервер сопоставит с диалогами сам — всё равно заполняй dialog_hints из списка, если можешь.",
  'intent "policy_patch" — сменить политику безопасности (как кнопки в «Безопасность / политика»): хотя бы одно из agent_scope, auto_in_groups. Режимы manual/suggest/auto в продукте отключены — не предлагай reply_mode.',
  'intent "delete_agent" / "set_default_agent" — agent_name из списка известных агентов.',
  'intent "assign_agent_to_dialog" — назначить существующего агента на чат: agent_hint + dialog_hint.',
  'intent "add_note" — сохранить заметку: note_body.',
].join("\n");

/**
 * Разбор JSON классификатора (без вызова LLM) — для тестов и отладки.
 */
export function nlPayloadFromClassifierJson(
  obj: Record<string, unknown>,
  userText: string,
  ctx: NlParseContext,
): NlPendingPayload | null {
  const intent = String(obj.intent ?? "none");
  if (intent === "none") return null;

  if (intent === "open_section") {
    const sec = String(obj.section ?? "agents");
    const map: Record<string, NlPendingPayload> = {
      agents: { t: "open_section", section: "agents" },
      notes: { t: "open_section", section: "notes" },
      chats: { t: "open_section", section: "chats" },
    };
    if (sec === "news") return { t: "open_section", section: "chats" };
    return map[sec] ?? { t: "open_section", section: "agents" };
  }

  if (intent === "create_agent") {
    const name = String(obj.agent_name ?? "").trim().slice(0, 120);
    if (!name) return null;
    let promptExtras = String(obj.agent_prompt ?? "").trim().slice(0, 8000);
    if (!promptExtras) {
      const stripped = stripFirstMessageCueBlock(userText);
      promptExtras = (stripped || userText.trim()).slice(0, 8000);
    }
    const linkTargets = mergeUniqueLinks(
      resolveDialogHintsToTargets(obj.dialog_hints, obj.dialog_hint, ctx.dialogs),
      inferLinkTargetsFromUserMessage(userText, ctx.dialogs),
    );
    const firstRaw =
      String(obj.first_message ?? "").trim().slice(0, 4096) || extractRawAfterFirstMessageCue(userText) || "";
    let firstMessage: string | undefined;
    if (firstRaw) {
      const sp = splitFirstOutboundMessage(firstRaw);
      firstMessage = sp.first || undefined;
      if (firstMessage) {
        promptExtras = stripFirstMessageCueBlock(promptExtras);
      }
      if (sp.rest) {
        const head = sp.rest.slice(0, Math.min(100, sp.rest.length));
        if (!promptExtras.includes(head)) {
          promptExtras = `${promptExtras}\n\n--- Условия после первого сообщения ---\n${sp.rest}`.trim().slice(0, 8000);
        }
      }
    }
    return {
      t: "create_agent",
      name,
      promptExtras,
      ...(linkTargets.length ? { linkTargets } : {}),
      ...(firstMessage ? { firstMessage } : {}),
    };
  }

  if (intent === "task_agent_reminder") {
    const name = String(obj.agent_name ?? "").trim().slice(0, 120);
    let promptExtras = String(obj.agent_prompt ?? "").trim().slice(0, 8000);
    const title = String(obj.reminder_title ?? "").trim().slice(0, 300);
    const text = String(obj.reminder_text ?? "").trim().slice(0, 4000);
    const minutes = Math.round(Number(obj.minutes));
    if (!name || !title || !Number.isFinite(minutes) || minutes < 1 || minutes > 10080) return null;
    const reminderText = text || title;
    if (!promptExtras || promptExtras.length < 3) return null;
    const linkTargets = mergeUniqueLinks(
      resolveDialogHintsToTargets(obj.dialog_hints, obj.dialog_hint, ctx.dialogs),
      inferLinkTargetsFromUserMessage(userText, ctx.dialogs),
    );
    const firstRaw =
      String(obj.first_message ?? "").trim().slice(0, 4096) || extractRawAfterFirstMessageCue(userText) || "";
    let firstMessage: string | undefined;
    if (firstRaw) {
      const sp = splitFirstOutboundMessage(firstRaw);
      firstMessage = sp.first || undefined;
      if (firstMessage) {
        promptExtras = stripFirstMessageCueBlock(promptExtras);
      }
      if (sp.rest) {
        const head = sp.rest.slice(0, Math.min(80, sp.rest.length));
        if (!promptExtras.includes(head)) {
          promptExtras = `${promptExtras}\n\n--- Условия после первого сообщения ---\n${sp.rest}`.trim().slice(0, 8000);
        }
      }
    }
    return {
      t: "task_agent_reminder",
      name,
      promptExtras,
      title,
      text: reminderText,
      minutes,
      ...(linkTargets.length ? { linkTargets } : {}),
      ...(firstMessage ? { firstMessage } : {}),
    };
  }

  if (intent === "add_reminder") {
    const title = String(obj.reminder_title ?? "").trim().slice(0, 300);
    const text = String(obj.reminder_text ?? "").trim().slice(0, 4000);
    const minutes = Math.round(Number(obj.minutes));
    if (!title || !Number.isFinite(minutes) || minutes < 1 || minutes > 10080) return null;
    return { t: "add_reminder", title, text: text || title, minutes };
  }

  if (intent === "policy_patch") {
    const scopeRaw = obj.agent_scope;
    let agentScope: AgentScope | undefined;
    if (scopeRaw !== undefined && scopeRaw !== null && String(scopeRaw).length) {
      const s = String(scopeRaw);
      if (s === "all" || s === "allowlist") agentScope = s;
    }
    let autoInGroups: boolean | undefined;
    if (obj.auto_in_groups !== undefined && obj.auto_in_groups !== null) {
      autoInGroups = Boolean(obj.auto_in_groups);
    }
    if (agentScope === undefined && autoInGroups === undefined) return null;
    return {
      t: "policy_patch",
      ...(agentScope !== undefined ? { agentScope } : {}),
      ...(autoInGroups !== undefined ? { autoInGroups } : {}),
    };
  }

  if (intent === "delete_agent") {
    const ag = resolveAgentByHint(String(obj.agent_name ?? ""), ctx.agents);
    if (!ag) return null;
    return { t: "delete_agent", agentId: ag.id, name: ag.name };
  }

  if (intent === "set_default_agent") {
    const ag = resolveAgentByHint(String(obj.agent_name ?? ""), ctx.agents);
    if (!ag) return null;
    return { t: "set_default_agent", agentId: ag.id, name: ag.name };
  }

  if (intent === "assign_agent_to_dialog") {
    const ag = resolveAgentByHint(String(obj.agent_hint ?? obj.agent_name ?? ""), ctx.agents);
    const d = resolveDialogByHint(String(obj.dialog_hint ?? ""), ctx.dialogs);
    if (!ag || !d) return null;
    return {
      t: "assign_agent_to_dialog",
      agentId: ag.id,
      agentName: ag.name,
      dialogId: d.id,
      label: d.label,
    };
  }

  if (intent === "add_note") {
    const body = String(obj.note_body ?? "").trim().slice(0, 8000);
    if (!body) return null;
    return { t: "add_note", body };
  }

  return null;
}

/**
 * Если строгий разбор вернул null (нет agent_name, нет minutes и т.д.), но intent — create_agent / task_agent_reminder,
 * собираем черновик с разумными значениями по умолчанию и без обязательного сопоставления чатов (пользователь выберет в боте).
 */
export function nlLenientPayloadFromClassifierJson(
  intent: string,
  obj: Record<string, unknown>,
  userText: string,
  ctx: NlParseContext,
): NlPendingPayload | null {
  const ut = userText.trim();
  if (intent === "create_agent") {
    let name = String(obj.agent_name ?? "").trim().slice(0, 120);
    if (!name) name = "Агент из запроса";
    let promptExtras = String(obj.agent_prompt ?? "").trim().slice(0, 8000);
    if (!promptExtras) {
      const stripped = stripFirstMessageCueBlock(userText);
      promptExtras = (stripped || ut).slice(0, 8000);
    }
    const linkTargets = mergeUniqueLinks(
      resolveDialogHintsToTargets(obj.dialog_hints, obj.dialog_hint, ctx.dialogs),
      inferLinkTargetsFromUserMessage(userText, ctx.dialogs),
    );
    const firstRaw =
      String(obj.first_message ?? "").trim().slice(0, 4096) || extractRawAfterFirstMessageCue(userText) || "";
    let firstMessage: string | undefined;
    if (firstRaw) {
      const sp = splitFirstOutboundMessage(firstRaw);
      firstMessage = sp.first || undefined;
      if (firstMessage) {
        promptExtras = stripFirstMessageCueBlock(promptExtras);
      }
      if (sp.rest) {
        const head = sp.rest.slice(0, Math.min(100, sp.rest.length));
        if (!promptExtras.includes(head)) {
          promptExtras = `${promptExtras}\n\n--- Условия после первого сообщения ---\n${sp.rest}`.trim().slice(0, 8000);
        }
      }
    }
    return {
      t: "create_agent",
      name,
      promptExtras,
      ...(linkTargets.length ? { linkTargets } : {}),
      ...(firstMessage ? { firstMessage } : {}),
    };
  }
  if (intent === "task_agent_reminder") {
    let name = String(obj.agent_name ?? "").trim().slice(0, 120);
    if (!name) name = "Задача из чата";
    let promptExtras = String(obj.agent_prompt ?? "").trim().slice(0, 8000);
    if (!promptExtras || promptExtras.length < 3) {
      const stripped = stripFirstMessageCueBlock(userText);
      promptExtras = (stripped || ut).slice(0, 8000);
    }
    let title = String(obj.reminder_title ?? "").trim().slice(0, 300);
    if (!title) title = "Напоминание по задаче";
    let text = String(obj.reminder_text ?? "").trim().slice(0, 4000);
    if (!text) text = title;
    let minutes = Math.round(Number(obj.minutes));
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10080) minutes = 240;
    const linkTargets = mergeUniqueLinks(
      resolveDialogHintsToTargets(obj.dialog_hints, obj.dialog_hint, ctx.dialogs),
      inferLinkTargetsFromUserMessage(userText, ctx.dialogs),
    );
    const firstRaw =
      String(obj.first_message ?? "").trim().slice(0, 4096) || extractRawAfterFirstMessageCue(userText) || "";
    let firstMessage: string | undefined;
    if (firstRaw) {
      const sp = splitFirstOutboundMessage(firstRaw);
      firstMessage = sp.first || undefined;
      if (firstMessage) {
        promptExtras = stripFirstMessageCueBlock(promptExtras);
      }
      if (sp.rest) {
        const head = sp.rest.slice(0, Math.min(80, sp.rest.length));
        if (!promptExtras.includes(head)) {
          promptExtras = `${promptExtras}\n\n--- Условия после первого сообщения ---\n${sp.rest}`.trim().slice(0, 8000);
        }
      }
    }
    return {
      t: "task_agent_reminder",
      name,
      promptExtras,
      title,
      text: text || title,
      minutes,
      ...(linkTargets.length ? { linkTargets } : {}),
      ...(firstMessage ? { firstMessage } : {}),
    };
  }
  return null;
}

/** Результат NL: действие, делегирование в обычный чат или явное сообщение пользователю. */
export type NlParseOutcome =
  | { kind: "ok"; payload: NlPendingPayload }
  | { kind: "delegate_chat" }
  | { kind: "user_message"; text: string };

/**
 * Распознавание намерения для оркестрации (агент, режим чата, напоминание, новости).
 */
export async function parseProductBotNlOutcome(
  userText: string,
  ctx: NlParseContext,
): Promise<NlParseOutcome> {
  const dialogLines = ctx.dialogs.slice(0, 40).map((d, i) => `${i + 1}. ${d.title || d.peerKey || d.id}`);
  const agentLine = ctx.agents.length ? ctx.agents.map((a) => a.name).join(", ") : "(нет)";
  const sys: ChatMsg = {
    role: "system",
    content: [
      "Ты классификатор команд для Telegram-бота личного аккаунта (автоответы MTProto, заметки, агенты).",
      "При intent task_agent_reminder пользователь описывает цель целиком — ты извлекаешь имя и инструкции для НОВОГО агента и отдельно формулируешь напоминание с интервалом в минутах.",
      NL_SCHEMA,
      "",
      "Известные агенты:",
      agentLine,
      "",
      "Диалоги (подсказка для dialog_hint):",
      dialogLines.length ? dialogLines.join("\n") : "(нет диалогов в БД)",
    ].join("\n"),
  };
  const user: ChatMsg = {
    role: "user",
    content: userText.slice(0, 3500),
  };
  let raw: string;
  try {
    raw = (await runChatCompletion([sys, user], nlOptions())).content;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      kind: "user_message",
      text: `Не удалось распознать намерение (ошибка вызова LLM). Проверьте сеть и переменные OPENCLAW_* / OPENAI_* / GigaChat в .env.\n${msg.slice(0, 300)}`,
    };
  }
  const obj = tryParseNlJson(raw);
  if (!obj) {
    return {
      kind: "user_message",
      text:
        "Ответ классификатора не удалось разобрать как JSON. Сократите запрос или повторите; проверьте PRODUCT_BOT_NL_* и доступность LLM.",
    };
  }
  const intent = String(obj.intent ?? "none");
  if (intent === "none") {
    return { kind: "delegate_chat" };
  }
  if (intent === "set_dialog_mode") {
    return {
      kind: "user_message",
      text: "Режимы **manual / suggest / auto** для отдельных чатов в продукте отключены. Политика: **Настройки** → **Безопасность / политика** (область агента и группы).",
    };
  }
  const payload = nlPayloadFromClassifierJson(obj, userText, ctx);
  if (payload) return { kind: "ok", payload };

  const lenient = nlLenientPayloadFromClassifierJson(intent, obj, userText, ctx);
  if (lenient) return { kind: "ok", payload: lenient };

  return {
    kind: "user_message",
    text:
      "Запрос не удалось разобрать в действие. Попробуйте короче или иначе сформулировать; для задач с чатами — откройте **Настройки** → **Чаты** и проверьте, что **worker** подтянул диалоги.",
  };
}

/** @deprecated Используйте parseProductBotNlOutcome для сообщений об ошибках. */
export async function parseProductBotNl(
  userText: string,
  ctx: NlParseContext,
): Promise<NlPendingPayload | null> {
  const o = await parseProductBotNlOutcome(userText, ctx);
  return o.kind === "ok" ? o.payload : null;
}

/** create_agent / task_agent_reminder: сначала выбор чатов в боте, потом подтверждение. */
export function needsNlChatPick(p: NlPendingPayload): boolean {
  return p.t === "create_agent" || p.t === "task_agent_reminder";
}

export function nlPendingStripLinkTargets(p: NlPendingPayload): NlPendingPayload {
  if (p.t === "create_agent") {
    const { linkTargets: _, ...rest } = p;
    return rest as NlPendingPayload;
  }
  if (p.t === "task_agent_reminder") {
    const { linkTargets: _, ...rest } = p;
    return rest as NlPendingPayload;
  }
  return p;
}

export function initialNlPickChatIds(p: NlPendingPayload): string[] {
  if (p.t === "create_agent" || p.t === "task_agent_reminder") {
    return p.linkTargets?.map((x) => x.dialogId) ?? [];
  }
  return [];
}

export function nlPendingWithLinkTargets(
  p: NlPendingPayload,
  links: NlDialogLink[] | undefined,
): NlPendingPayload {
  if (p.t === "create_agent") {
    return { ...p, linkTargets: links?.length ? links : undefined };
  }
  if (p.t === "task_agent_reminder") {
    return { ...p, linkTargets: links?.length ? links : undefined };
  }
  return p;
}

/** Текст шага 1: выбор чатов перед итоговым превью. */
export function formatNlPickChatsStepHeader(p: NlPendingPayload): string {
  const head =
    p.t === "create_agent"
      ? `Черновик агента: «${p.name}»`
      : p.t === "task_agent_reminder"
        ? `Черновик: агент «${p.name}» + напоминание`
        : "Черновик";
  return [
    "Шаг 1/2. **Список чатов** ниже — отметьте ✓ те, где агент будет работать (можно **ни одного**).",
    "Сюда попадают личные диалоги (MTProto) и чаты, которые вы **подключили к боту**, если они уже подтянулись в ту же базу.",
    "",
    head,
    "",
    "«**Далее**» — превью и подтверждение.",
  ].join("\n");
}

export function formatNlPendingSummary(p: NlPendingPayload): string {
  switch (p.t) {
    case "create_agent":
      return [
        "Подтвердите создание агента:",
        "",
        `Имя: ${p.name}`,
        p.promptExtras ? `Инструкции:\n${p.promptExtras.slice(0, 3500)}` : "",
        p.linkTargets?.length ? `Чаты (привязка): ${p.linkTargets.map((t) => t.label).join(", ")}` : "",
        p.firstMessage ? `Первое исходящее в эти чаты:\n${p.firstMessage.slice(0, 1500)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    case "task_agent_reminder":
      return [
        "Задача: черновик агента + напоминание",
        "",
        `Агент «${p.name}»`,
        `Инструкции:\n${p.promptExtras.slice(0, 3500)}`,
        p.linkTargets?.length ? `Чаты (привязка): ${p.linkTargets.map((t) => t.label).join(", ")}` : "",
        p.firstMessage ? `Первое исходящее:\n${p.firstMessage.slice(0, 1500)}` : "",
        "",
        "Напоминание:",
        `Заголовок: ${p.title}`,
        `Текст: ${p.text.slice(0, 400)}`,
        `Через: ${p.minutes} мин.`,
      ]
        .filter(Boolean)
        .join("\n");
    case "add_reminder":
      return [
        "Напоминание:",
        "",
        `Заголовок: ${p.title}`,
        `Текст: ${p.text.slice(0, 400)}`,
        `Через: ${p.minutes} мин.`,
      ].join("\n");
    case "open_section":
      return "Открыть раздел меню — подтверждение не требуется.";
    case "policy_patch": {
      const bits: string[] = [];
      if (p.agentScope !== undefined) bits.push(`область ${p.agentScope}`);
      if (p.autoInGroups !== undefined) bits.push(p.autoInGroups ? "группы вкл" : "группы выкл");
      return `Политика / безопасность: ${bits.join(", ") || "изменения"}`;
    }
    case "delete_agent":
      return `Удалить агента «${p.name.slice(0, 80)}»`;
    case "set_default_agent":
      return `Сделать агента «${p.name.slice(0, 80)}» по умолчанию`;
    case "assign_agent_to_dialog":
      return `Назначить «${p.agentName.slice(0, 40)}» на чат «${p.label.slice(0, 60)}»`;
    case "add_note":
      return `Заметка: ${p.body.slice(0, 500)}`;
    default:
      return "Действие";
  }
}

/** После создания ProductAgent: привязка к диалогам MTProto, allowlist, опционально очередь первого исходящего (TgPendingSend). */
async function applyAgentLinksAndOutreach(
  appUserId: string,
  accountId: string | null,
  agentId: string,
  linkTargets: NlDialogLink[] | undefined,
  firstMessage: string | undefined,
  agentBrief: { name: string; promptExtras: string },
): Promise<{ lines: string[]; pendingConfirms: { id: string; label: string; text: string }[] }> {
  const lines: string[] = [];
  const pendingConfirms: { id: string; label: string; text: string }[] = [];
  if (!linkTargets?.length) return { lines, pendingConfirms };

  if (!accountId) {
    lines.push(
      "Личный Telegram (коннектор) не подключён — чаты из запроса не привязаны, исходящие не поставлены в очередь. Подключите аккаунт и повторите или назначьте чаты в «Агенты».",
    );
    return { lines, pendingConfirms };
  }

  const okIds: string[] = [];
  for (const { dialogId, label } of linkTargets) {
    try {
      await setDialogAgent(appUserId, agentId, dialogId);
      await maybeAddDialogToAgentAllowlist(accountId, dialogId);
      okIds.push(dialogId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lines.push(`Не привязан «${label.slice(0, 48)}»: ${msg.slice(0, 160)}`);
    }
  }

  if (okIds.length > 0) {
    const okLabels = linkTargets.filter((t) => okIds.includes(t.dialogId)).map((t) => t.label);
    lines.unshift(`Привязка к чатам: ${okLabels.join(", ")}.`);
  }

  const fm = firstMessage?.trim();
  const prompt = (agentBrief.promptExtras || "").trim();
  const autoOutbound = process.env.PRODUCT_BOT_NL_AUTO_OUTBOUND?.trim() !== "0";
  const synthWithoutFirst = process.env.PRODUCT_BOT_NL_SYNTH_OUTBOUND?.trim() !== "0" && prompt.length >= 20;

  if (!autoOutbound) {
    if (fm && okIds.length > 0) {
      lines.push(
        "Текст первого сообщения **не** поставлен в очередь автоматически (`PRODUCT_BOT_NL_AUTO_OUTBOUND=0`). Откройте **Агенты** → задача по шаблону или отчёт по задаче → **Подготовить ответ** и подтвердите **«Отправить»**.",
      );
    } else if (fm && okIds.length === 0) {
      lines.push("Первое сообщение не отправлено — не удалось привязать ни один чат.");
    }
    return { lines, pendingConfirms };
  }

  if (okIds.length === 0) {
    if (fm) lines.push("Первое сообщение не отправлено — не удалось привязать ни один чат.");
    return { lines, pendingConfirms };
  }

  const canBuildText = Boolean(fm) || synthWithoutFirst;
  if (!canBuildText) {
    if (prompt.length > 0) {
      lines.push(
        "Исходящее из NL не сформировано: добавьте в запрос **первое сообщение** («напиши первым: …») или удлините инструкции (≥20 симв.), либо включите синтез: по умолчанию он включён (`PRODUCT_BOT_NL_SYNTH_OUTBOUND` не `0`).",
      );
    }
    return { lines, pendingConfirms };
  }

    const targets = linkTargets.filter((t) => okIds.includes(t.dialogId));
  let drafts = 0;
  for (const t of targets) {
    let text: string;
    try {
      text = await resolveNlOutboundTextForDialog({
        agentName: agentBrief.name,
        promptExtras: prompt || "—",
        rawFirstMessage: fm || undefined,
        peerLabel: t.label,
      });
    } catch {
      text = (fm || prompt).slice(0, 4096);
    }
    const r = await enqueueUserAccountOutboundAwaitingConfirm(appUserId, accountId, t.dialogId, text);
    if (r.ok && r.pendingId) {
      drafts++;
      lines.push(
        `**${t.label.slice(0, 56)}** — подготовлен **черновик**. Подтвердите отправку в боте (кнопки появятся ниже).`,
      );
      pendingConfirms.push({ id: r.pendingId, label: t.label, text });
    } else {
      lines.push(`**${t.label.slice(0, 56)}** — не в очереди: ${r.message}`);
    }
  }
  if (drafts > 0) {
    lines.push("Проверьте, что **worker** запущен (после подтверждения) и в политике аккаунта разрешена отправка (`sendAllowed`).");
  }

  return { lines, pendingConfirms };
}

export async function executeNlPending(
  appUserId: string,
  accountId: string | null,
  p: Exclude<NlPendingPayload, { t: "open_section" }>,
): Promise<{ ok: boolean; message: string; pendingConfirms?: { id: string; label: string; text: string }[] }> {
  try {
    if (
      (p.t === "create_agent" || p.t === "task_agent_reminder") &&
      (await needsTelegramMtprotoLogin(appUserId))
    ) {
      return { ok: false, message: NL_AGENT_REQUIRES_MTPROTO_MESSAGE };
    }
    if (p.t === "create_agent") {
      const agent = await createProductAgent(appUserId, { name: p.name, promptExtras: p.promptExtras || undefined });
      const { lines: linkLines, pendingConfirms } = await applyAgentLinksAndOutreach(
        appUserId,
        accountId,
        agent.id,
        p.linkTargets,
        p.firstMessage,
        { name: p.name, promptExtras: p.promptExtras || "" },
      );
      const parts = [`Агент «${p.name}» создан.`];
      parts.push(...linkLines);
      if (!p.linkTargets?.length) {
        parts.push("Назначение чатов: меню «Агенты» → карточка агента.");
      }
      return { ok: true, message: parts.join("\n"), ...(pendingConfirms.length ? { pendingConfirms } : {}) };
    }
    if (p.t === "task_agent_reminder") {
      const agent = await createProductAgent(appUserId, { name: p.name, promptExtras: p.promptExtras });
      const { lines: linkLines, pendingConfirms } = await applyAgentLinksAndOutreach(
        appUserId,
        accountId,
        agent.id,
        p.linkTargets,
        p.firstMessage,
        { name: p.name, promptExtras: p.promptExtras },
      );
      const acc = await prisma.tgAccount.findUnique({ where: { appUserId } });
      const fireAt = new Date(Date.now() + p.minutes * 60 * 1000);
      try {
        await prisma.reminder.create({
          data: {
            appUserId,
            accountId: acc?.id ?? null,
            title: p.title,
            text: p.text,
            fireAt,
            notifyTelegram: true,
            notifyWeb: true,
            status: "pending",
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          message: [
            `Агент «${p.name}» создан.`,
            ...linkLines,
            `Напоминание не сохранено: ${msg.slice(0, 400)}`,
          ].join("\n"),
        };
      }
      return {
        ok: true,
        message: [
          `Агент «${p.name}» создан.`,
          ...linkLines,
          `Напоминание «${p.title.slice(0, 80)}» — ${fireAt.toLocaleString("ru-RU")}.`,
        ].join("\n"),
        ...(pendingConfirms.length ? { pendingConfirms } : {}),
      };
    }
    if (p.t === "add_reminder") {
      const acc = await prisma.tgAccount.findUnique({ where: { appUserId } });
      const fireAt = new Date(Date.now() + p.minutes * 60 * 1000);
      await prisma.reminder.create({
        data: {
          appUserId,
          accountId: acc?.id ?? null,
          title: p.title,
          text: p.text,
          fireAt,
          notifyTelegram: true,
          notifyWeb: true,
          status: "pending",
        },
      });
      return {
        ok: true,
        message: `Напоминание запланировано на ${fireAt.toLocaleString("ru-RU")}.`,
      };
    }
    if (p.t === "policy_patch") {
      if (!accountId) return { ok: false, message: "Личный аккаунт не подключён." };
      await patchPolicyFromBot(accountId, {
        ...(p.agentScope !== undefined ? { agentScope: p.agentScope } : {}),
        ...(p.autoInGroups !== undefined ? { autoInGroups: p.autoInGroups } : {}),
      });
      const bits: string[] = [];
      if (p.agentScope !== undefined) bits.push(`область ${p.agentScope}`);
      if (p.autoInGroups !== undefined) bits.push(p.autoInGroups ? "группы вкл" : "группы выкл");
      return { ok: true, message: `Политика обновлена: ${bits.join(", ")}.` };
    }
    if (p.t === "delete_agent") {
      await deleteProductAgent(appUserId, p.agentId);
      return { ok: true, message: `Агент «${p.name.slice(0, 80)}» удалён.` };
    }
    if (p.t === "set_default_agent") {
      await updateProductAgent(appUserId, p.agentId, { isDefault: true });
      return { ok: true, message: `Агент «${p.name.slice(0, 80)}» сделан по умолчанию.` };
    }
    if (p.t === "assign_agent_to_dialog") {
      if (!accountId) return { ok: false, message: "Личный аккаунт не подключён." };
      await setDialogAgent(appUserId, p.agentId, p.dialogId);
      await maybeAddDialogToAgentAllowlist(accountId, p.dialogId);
      return {
        ok: true,
        message: `Агент «${p.agentName}» назначен на чат «${p.label.slice(0, 60)}».`,
      };
    }
    if (p.t === "add_note") {
      await prisma.userNote.create({ data: { appUserId, body: p.body } });
      return { ok: true, message: "Заметка сохранена." };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg.slice(0, 500) };
  }
  return { ok: false, message: "Неизвестное действие." };
}

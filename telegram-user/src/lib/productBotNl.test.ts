import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNlLinkTargetsFromIds,
  extractFirstMessageFromUserText,
  isProductBotNlConfirmRequired,
  nlLenientPayloadFromClassifierJson,
  nlPayloadFromClassifierJson,
  nlPendingWithLinkTargets,
  splitFirstOutboundMessage,
} from "./productBotNl.js";

/** Сгенерированные UUID для изоляции тестовой «сессии». */
const D_WORK = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const D_FAMILY = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12";
const D_KAMIL = "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15";
const A_MAIN = "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13";
const A_AUX = "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14";

const ctx = {
  dialogs: [
    { id: D_WORK, title: "Работа · Петя", peerKey: "user:1" },
    { id: D_FAMILY, title: "Семья", peerKey: "user:2" },
    { id: D_KAMIL, title: "Камил · друг", peerKey: "user:3" },
  ],
  agents: [
    { id: A_MAIN, name: "Помощник" },
    { id: A_AUX, name: "Бэкап-агент" },
  ],
};

describe("nlPayloadFromClassifierJson", () => {
  it("open_section → agents", () => {
    const p = nlPayloadFromClassifierJson({ intent: "open_section", section: "agents" }, "", ctx);
    assert.equal(p?.t, "open_section");
    if (p?.t === "open_section") assert.equal(p.section, "agents");
  });

  it("create_agent + link inference", () => {
    const user =
      'Создай агента «Тест» для чатов с Петя. Инструкции: кратко. Напиши им первым: Привет!';
    const p = nlPayloadFromClassifierJson(
      {
        intent: "create_agent",
        agent_name: "Тест",
        agent_prompt: "Кратко отвечать.",
        dialog_hints: ["Работа"],
      },
      user,
      ctx,
    );
    assert.equal(p?.t, "create_agent");
    if (p?.t === "create_agent") {
      assert.equal(p.name, "Тест");
      assert.ok(p.linkTargets?.some((x) => x.dialogId === D_WORK));
      assert.equal(p.firstMessage?.includes("Привет"), true);
    }
  });

  it("add_reminder", () => {
    const p = nlPayloadFromClassifierJson(
      {
        intent: "add_reminder",
        reminder_title: "Звонок",
        reminder_text: "Клиенту",
        minutes: 30,
      },
      "",
      ctx,
    );
    assert.equal(p?.t, "add_reminder");
    if (p?.t === "add_reminder") {
      assert.equal(p.minutes, 30);
      assert.equal(p.title, "Звонок");
    }
  });

  it("set_dialog_mode больше не парсится в payload", () => {
    assert.equal(
      nlPayloadFromClassifierJson(
        { intent: "set_dialog_mode", dialog_hint: "Семья", reply_mode: "suggest" },
        "",
        ctx,
      ),
      null,
    );
  });

  it("policy_patch", () => {
    const p = nlPayloadFromClassifierJson(
      { intent: "policy_patch", agent_scope: "all", auto_in_groups: false },
      "",
      ctx,
    );
    assert.equal(p?.t, "policy_patch");
    if (p?.t === "policy_patch") {
      assert.equal(p.agentScope, "all");
      assert.equal(p.autoInGroups, false);
    }
  });

  it("delete_agent resolves by name", () => {
    const p = nlPayloadFromClassifierJson({ intent: "delete_agent", agent_name: "Помощник" }, "", ctx);
    assert.equal(p?.t, "delete_agent");
    if (p?.t === "delete_agent") {
      assert.equal(p.agentId, A_MAIN);
    }
  });

  it("assign_agent_to_dialog", () => {
    const p = nlPayloadFromClassifierJson(
      { intent: "assign_agent_to_dialog", agent_hint: "Бэкап", dialog_hint: "Семья" },
      "",
      ctx,
    );
    assert.equal(p?.t, "assign_agent_to_dialog");
    if (p?.t === "assign_agent_to_dialog") {
      assert.equal(p.agentId, A_AUX);
      assert.equal(p.dialogId, D_FAMILY);
    }
  });

  it("open_section legacy news → chats", () => {
    const p = nlPayloadFromClassifierJson({ intent: "open_section", section: "news" }, "", ctx);
    assert.equal(p?.t, "open_section");
    if (p?.t === "open_section") assert.equal(p.section, "chats");
  });

  it("add_note", () => {
    const p = nlPayloadFromClassifierJson(
      { intent: "add_note", note_body: "Встреча во вторник 15:00" },
      "",
      ctx,
    );
    assert.equal(p?.t, "add_note");
    if (p?.t === "add_note") assert.ok(p.body.includes("вторник"));
  });

  it("intent none → null", () => {
    assert.equal(nlPayloadFromClassifierJson({ intent: "none" }, "", ctx), null);
  });

  it("empty policy_patch → null", () => {
    assert.equal(nlPayloadFromClassifierJson({ intent: "policy_patch" }, "", ctx), null);
  });

  it("create_agent: короткое первое сообщение, хвост в promptExtras", () => {
    const user =
      "Создай агента «Напоминалка». Напиши им первым: Привет, как дела? — если он не ответит в течение часа, напиши ещё раз завтра утром.";
    const p = nlPayloadFromClassifierJson(
      {
        intent: "create_agent",
        agent_name: "Напоминалка",
        agent_prompt: "Быть вежливым.",
      },
      user,
      ctx,
    );
    assert.equal(p?.t, "create_agent");
    if (p?.t === "create_agent") {
      assert.equal(p.firstMessage, "Привет, как дела?");
      assert.ok(p.promptExtras.includes("--- Условия после первого сообщения ---"));
      assert.ok(p.promptExtras.includes("если он не ответит"));
    }
  });

  it("resolveDialogByHint: короткая подсказка «Кам» → «Камил …» (assign_agent_to_dialog)", () => {
    const p = nlPayloadFromClassifierJson(
      { intent: "assign_agent_to_dialog", agent_hint: "Бэкап", dialog_hint: "Кам" },
      "",
      ctx,
    );
    assert.equal(p?.t, "assign_agent_to_dialog");
    if (p?.t === "assign_agent_to_dialog") {
      assert.equal(p.dialogId, D_KAMIL);
    }
  });

  it("create_agent: «напиши пользователю Кам и попроси…» — first_message без «первым:»", () => {
    const user =
      'Создай Агента "Диплом" напиши пользователю Кам и попроси его прислать дипломную работу нам';
    const p = nlPayloadFromClassifierJson(
      {
        intent: "create_agent",
        agent_name: "Диплом",
        agent_prompt: "Следить за перепиской про диплом.",
      },
      user,
      ctx,
    );
    assert.equal(p?.t, "create_agent");
    if (p?.t === "create_agent") {
      assert.ok(p.linkTargets?.some((x) => x.dialogId === D_KAMIL), "ожидалась привязка к диалогу по «пользователю Кам»");
      assert.ok(p.firstMessage?.includes("попроси"), "ожидался текст после «…Кам и …»");
      assert.ok(p.firstMessage?.toLowerCase().includes("диплом"));
    }
  });

  it("inferLinkTargets: «для чатов с Кам, напиши им первым»", () => {
    const user =
      "Создай агента Научник для чатов с Кам, напиши им первым: Привет, скинь дипломник — если он пришлёт проект, проверь.";
    const p = nlPayloadFromClassifierJson(
      { intent: "create_agent", agent_name: "Научник", agent_prompt: "Чаты с Кам." },
      user,
      ctx,
    );
    assert.equal(p?.t, "create_agent");
    if (p?.t === "create_agent") {
      assert.ok(p.linkTargets?.some((x) => x.dialogId === D_KAMIL), "ожидалась привязка к диалогу Камил");
    }
  });

  it("create_agent: из инструкций убирается дубль «напиши им первым»", () => {
    const user =
      "Создай агента. Напиши им первым: Привет, скинь дипломник — если он пришлёт проект, проверь файл.";
    const p = nlPayloadFromClassifierJson(
      {
        intent: "create_agent",
        agent_name: "T",
        agent_prompt:
          "Чаты с Кам. Напиши им первым: Привет, скинь дипломник — если он пришлёт проект, проверь файл.",
      },
      user,
      ctx,
    );
    assert.equal(p?.t, "create_agent");
    if (p?.t === "create_agent") {
      assert.equal(p.firstMessage, "Привет, скинь дипломник");
      assert.equal(p.promptExtras.includes("Напиши им первым"), false);
      assert.ok(p.promptExtras.includes("Чаты с Кам"));
      assert.ok(p.promptExtras.includes("если он пришлёт") || p.promptExtras.includes("если он пришлет"));
    }
  });
});

describe("splitFirstOutboundMessage", () => {
  it("режет по « — если …»", () => {
    const s = "Привет! — если он молчит до вечера, напиши завтра.";
    const { first, rest } = splitFirstOutboundMessage(s);
    assert.equal(first, "Привет!");
    assert.ok(rest.startsWith("если "));
  });

  it("первая строка отдельно, если ниже достаточно текста", () => {
    const s = "Коротко\n\nЕсли нужно, уточни завтра и добавь детали про время встречи.";
    const { first, rest } = splitFirstOutboundMessage(s);
    assert.equal(first, "Коротко");
    assert.ok(rest.length > 8);
  });
});

describe("extractFirstMessageFromUserText", () => {
  it("возвращает только короткую часть после «напиши … первым:»", () => {
    const user =
      "Для чатов с Петя. Напиши им первым: Здравствуй — если ответит до 19:00, спроси про диплом.";
    assert.equal(extractFirstMessageFromUserText(user), "Здравствуй");
  });

  it("«напиши пользователю Кам и …» — тоже извлекается", () => {
    const user =
      'Создай агента "Диплом" напиши пользователю Кам и попроси его прислать дипломную работу нам';
    const fm = extractFirstMessageFromUserText(user);
    assert.ok(fm?.includes("попроси"));
    assert.ok(fm?.toLowerCase().includes("диплом"));
  });
});

describe("nl pick helpers", () => {
  it("buildNlLinkTargetsFromIds фильтрует неизвестные id", () => {
    const dialogs = [
      { id: D_WORK, title: "A", peerKey: "u:1" },
      { id: D_FAMILY, title: "B", peerKey: "u:2" },
    ];
    const links = buildNlLinkTargetsFromIds([D_FAMILY, "00000000-0000-0000-0000-000000000000"], dialogs);
    assert.equal(links.length, 1);
    assert.equal(links[0].dialogId, D_FAMILY);
    assert.equal(links[0].label, "B");
  });

  it("nlPendingWithLinkTargets добавляет привязки", () => {
    const base = nlPayloadFromClassifierJson(
      { intent: "create_agent", agent_name: "X", agent_prompt: "p" },
      "",
      ctx,
    );
    assert.equal(base?.t, "create_agent");
    if (base?.t !== "create_agent") return;
    const withLinks = nlPendingWithLinkTargets(base, [
      { dialogId: D_WORK, label: "Работа · Петя" },
    ]);
    assert.equal(withLinks.t, "create_agent");
    if (withLinks.t === "create_agent") {
      assert.equal(withLinks.linkTargets?.length, 1);
    }
  });
});

describe("nlLenientPayloadFromClassifierJson", () => {
  it("create_agent без agent_name — имя по умолчанию и привязка «Кам» из текста", () => {
    const p = nlLenientPayloadFromClassifierJson(
      "create_agent",
      { intent: "create_agent", agent_prompt: "Спросить про диплом" },
      "Напиши пользователю Кам про диплом",
      ctx,
    );
    assert.equal(p?.t, "create_agent");
    if (p?.t === "create_agent") {
      assert.equal(p.name, "Агент из запроса");
      assert.ok(p.promptExtras.includes("диплом"));
      assert.ok(p.linkTargets?.some((x) => x.dialogId === D_KAMIL));
    }
  });

  it("task_agent_reminder без minutes — дефолт 240", () => {
    const p = nlLenientPayloadFromClassifierJson(
      "task_agent_reminder",
      {
        intent: "task_agent_reminder",
        agent_name: "Диплом",
        agent_prompt: "Писать вежливо",
        reminder_title: "Пинг",
        reminder_text: "Спросить статус",
      },
      "x",
      ctx,
    );
    assert.equal(p?.t, "task_agent_reminder");
    if (p?.t === "task_agent_reminder") {
      assert.equal(p.minutes, 240);
    }
  });
});

describe("isProductBotNlConfirmRequired", () => {
  it("по умолчанию false; при PRODUCT_BOT_NL_CONFIRM=1 — true", () => {
    const prev = process.env.PRODUCT_BOT_NL_CONFIRM;
    try {
      delete process.env.PRODUCT_BOT_NL_CONFIRM;
      assert.equal(isProductBotNlConfirmRequired(), false);
      process.env.PRODUCT_BOT_NL_CONFIRM = "1";
      assert.equal(isProductBotNlConfirmRequired(), true);
    } finally {
      if (prev === undefined) delete process.env.PRODUCT_BOT_NL_CONFIRM;
      else process.env.PRODUCT_BOT_NL_CONFIRM = prev;
    }
  });
});

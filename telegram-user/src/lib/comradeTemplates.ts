import type { ComradeTemplateType } from "./prismaComradeTypes.js";

export type ComradeTemplateDef = {
  type: ComradeTemplateType;
  nameRu: string;
  goal: string;
  askUser: string[];
  /** Подсказка для следующего шага после первого контакта */
  nextStep: string;
  completion: string;
  /** Черновик первого сообщения контакту (подстановки {{title}}, {{objective}}) */
  firstMessageTemplate: string;
};

export const COMRADE_TEMPLATES: Record<ComradeTemplateType, ComradeTemplateDef> = {
  GET_DOCUMENT: {
    type: "GET_DOCUMENT",
    nameRu: "Получить документ",
    goal: "Получить от контакта нужный файл или подписанный документ.",
    askUser: ["Какой документ нужен", "Дедлайн или важные детали"],
    nextStep: "Дождаться ответа или файла; при молчании — вежливый follow-up после паузы.",
    completion: "Документ получен или контакт явно отказал/перенёс на согласованные условия.",
    firstMessageTemplate:
      "Здравствуйте!\n\nПо задаче «{{title}}» прошу прислать документ / материалы по следующему контексту:\n{{objective}}\n\nЗаранее спасибо.",
  },
  FOLLOWUP_REPLY: {
    type: "FOLLOWUP_REPLY",
    nameRu: "Дожать ответ",
    goal: "Получить ответ на ранее заданный вопрос или запрос.",
    askUser: ["О чём был исходный запрос", "На что ждём ответ"],
    nextStep: "Коротко напомнить о запросе и предложить удобный срок ответа.",
    completion: "Получен содержательный ответ или зафиксирована новая дата/следующий шаг.",
    firstMessageTemplate:
      "Здравствуйте!\n\nНапоминаю по «{{title}}»: {{objective}}\n\nПодскажите, пожалуйста, когда сможете ответить?",
  },
  SCHEDULE_MEETING: {
    type: "SCHEDULE_MEETING",
    nameRu: "Назначить встречу",
    goal: "Согласовать слот для звонка или встречи.",
    askUser: ["Длительность и формат (звонок/офлайн)", "Ваши окна по времени"],
    nextStep: "Предложить 2–3 конкретных слота; после согласия — подтвердить в календаре.",
    completion: "Время и формат встречи согласованы.",
    firstMessageTemplate:
      "Здравствуйте!\n\nПо «{{title}}» хотел(а) бы согласовать встречу/звонок.\nКонтекст: {{objective}}\n\nПредлагаю обсудить удобные варианты времени.",
  },
  COLLECT_INFO: {
    type: "COLLECT_INFO",
    nameRu: "Собрать информацию",
    goal: "Собрать недостающие данные у контакта по чек-листу.",
    askUser: ["Какие именно поля нужны", "Зачем они нужны (кратко)"],
    nextStep: "Задать чёткие вопросы списком; при частичном ответе — уточнить остальное.",
    completion: "Все необходимые поля получены или зафиксирован отказ/альтернатива.",
    firstMessageTemplate:
      "Здравствуйте!\n\nПо задаче «{{title}}» нужна информация:\n{{objective}}\n\nБуду благодарен(на) за ответы по пунктам.",
  },
  REMIND_AGREEMENT: {
    type: "REMIND_AGREEMENT",
    nameRu: "Напомнить о договорённости",
    goal: "Мягко напомнить о ранее достигнутой договорённости или дедлайне.",
    askUser: ["О какой договорённости речь", "К какой дате привязка"],
    nextStep: "Если нет реакции — один деликатный повтор с предложением помощи.",
    completion: "Контакт подтвердил выполнение/новый срок или объяснил задержку.",
    firstMessageTemplate:
      "Здравствуйте!\n\nНапоминаю о договорённости по «{{title}}»:\n{{objective}}\n\nПодтвердите, пожалуйста, статус, когда будет удобно.",
  },
};

export const COMRADE_TEMPLATE_ORDER: ComradeTemplateType[] = [
  "GET_DOCUMENT",
  "FOLLOWUP_REPLY",
  "SCHEDULE_MEETING",
  "COLLECT_INFO",
  "REMIND_AGREEMENT",
];

export function buildFirstMessage(
  templateType: ComradeTemplateType,
  title: string,
  objective: string,
): string {
  const t = COMRADE_TEMPLATES[templateType];
  return t.firstMessageTemplate.replace(/\{\{title\}\}/g, title.trim()).replace(/\{\{objective\}\}/g, objective.trim());
}

export function formatTemplateHelp(t: ComradeTemplateDef): string {
  return [
    `**${t.nameRu}**`,
    "",
    `Цель: ${t.goal}`,
    "",
    "Что уточнить у вас при создании:",
    ...t.askUser.map((q) => `· ${q}`),
    "",
    `Следующий шаг после контакта: ${t.nextStep}`,
    "",
    `Завершение: ${t.completion}`,
  ].join("\n");
}

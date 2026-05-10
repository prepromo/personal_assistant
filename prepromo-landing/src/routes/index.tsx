import { motion } from "framer-motion";
import {
  MessageSquare, Bell, FileEdit, CheckCircle2, Sparkles, Send,
  Shield, Users, Briefcase, Rocket, ArrowRight, Bot, Search,
  Calendar, FileText, Target, Inbox, Globe, LayoutDashboard,
  ChevronDown, Wallet,
} from "lucide-react";
import { useState } from "react";
import heroImg from "@/assets/hero.png";

const TG = import.meta.env.VITE_TG_BOT_URL ?? "https://t.me/Test_agent_AI_companion_bot";

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: "easeOut" },
};

function Nav() {
  return (
    <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/70 border-b border-border/50">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-primary grid place-items-center shadow-soft">
            <Bot className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-display font-bold text-lg">Comrade AI</span>
        </div>
        <nav className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
          <a href="#features" className="hover:text-foreground transition">Возможности</a>
          <a href="#how" className="hover:text-foreground transition">Как работает</a>
          <a href="#pricing" className="hover:text-foreground transition">Тариф</a>
          <a href="#roadmap" className="hover:text-foreground transition">Развитие</a>
          <a href="#faq" className="hover:text-foreground transition">FAQ</a>
        </nav>
        <a href={TG} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-primary text-primary-foreground text-sm font-medium shadow-soft hover:shadow-glow transition-all">
          <Send className="w-4 h-4" /> Telegram
        </a>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-hero">
      <div className="max-w-7xl mx-auto px-6 pt-20 pb-24 grid lg:grid-cols-2 gap-12 items-center">
        <motion.div {...fadeUp}>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border shadow-soft text-xs font-medium text-muted-foreground mb-6">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            Ассистент для переписок
          </div>
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.05] mb-6">
            <span className="text-foreground">Ассистент, который ведёт</span>
            <br />
            <span className="text-gradient">диалоги за вас</span>
          </h1>
          <div className="text-lg text-muted-foreground max-w-xl mb-8 leading-relaxed space-y-3">
            <p>
              Создаёте агента под цель (“дожать отчёт”, “согласовать встречу”) — он ведёт переписку по контексту, напоминает и доводит до результата.
            </p>
            <p className="font-medium text-foreground/90">
              Отправка сообщений — только после вашего подтверждения.
            </p>
            <p className="text-sm">
              Подключение Telegram нужно, чтобы агент работал в ваших диалогах. Это делается один раз.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href={TG} className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-gradient-primary text-primary-foreground font-medium shadow-elegant hover:shadow-glow transition-all hover:-translate-y-0.5">
              <Send className="w-4 h-4" /> Попробовать в Telegram
            </a>
            <a href="#features" className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-card border border-border font-medium hover:border-primary transition">
              Посмотреть возможности <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8 }} className="relative">
          <div className="absolute inset-0 bg-gradient-primary opacity-20 blur-3xl rounded-full" />
          <img src={heroImg} alt="Comrade AI интерфейс" width={1280} height={1280} className="relative w-full max-w-lg mx-auto animate-float" />
        </motion.div>
      </div>
    </section>
  );
}

function SectionTitle({ kicker, title, subtitle }: { kicker?: string; title: string; subtitle?: string }) {
  return (
    <motion.div {...fadeUp} className="text-center max-w-3xl mx-auto mb-14">
      {kicker && <div className="text-sm font-medium text-primary mb-3">{kicker}</div>}
      <h2 className="text-4xl md:text-5xl font-bold mb-4">{title}</h2>
      {subtitle && <p className="text-lg text-muted-foreground">{subtitle}</p>}
    </motion.div>
  );
}

function Card({ icon: Icon, title, desc, badge }: any) {
  return (
    <motion.div {...fadeUp} className="group p-7 rounded-3xl bg-card border border-border shadow-soft hover:shadow-elegant transition-all hover:-translate-y-1">
      <div className="w-12 h-12 rounded-2xl bg-gradient-soft grid place-items-center mb-5 group-hover:bg-gradient-primary transition-all">
        <Icon className="w-6 h-6 text-primary group-hover:text-primary-foreground transition-colors" />
      </div>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="font-display font-semibold text-lg">{title}</h3>
        {badge && <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">{badge}</span>}
      </div>
      <p className="text-muted-foreground leading-relaxed">{desc}</p>
    </motion.div>
  );
}

function Features() {
  const items = [
    { icon: MessageSquare, title: "Агенты в ваших диалогах", desc: "Один агент — одна цель. Он держит контекст и предлагает следующий шаг в переписке." },
    { icon: FileEdit, title: "Черновики ответов как человек", desc: "Агент формулирует коротко и по делу — вы подтверждаете отправку перед тем, как что‑то уйдёт." },
    { icon: CheckCircle2, title: "Контроль договорённостей", desc: "Помнит, кто что обещал, и возвращает к вопросу вовремя." },
    { icon: Bell, title: "Дожим до результата", desc: "Если молчат — аккуратно напомнит по сценарию, пока задача не будет закрыта." },
    { icon: Search, title: "Сводка “Today”", desc: "Что важно сегодня: кому написать, где дедлайны и где нет ответа.", badge: "Скоро" },
    { icon: FileText, title: "Заметки и напоминания", desc: "Фиксируйте идеи и ставьте напоминания прямо в Telegram, чтобы ничего не терять." },
  ];
  return (
    <section id="features" className="py-28 px-6">
      <div className="max-w-7xl mx-auto">
        <SectionTitle
          kicker="Что умеют агенты"
          title="Агенты для переписок и задач"
          subtitle="Один агент — одна цель. Он держит контекст, пишет “как человек” и напоминает, пока не получит результат."
        />
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((it, i) => <Card key={i} {...it} />)}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", title: "Ставите цель агенту", desc: "«Дожми отчёт», «согласуй встречу», «собери документы» — в одном сообщении." },
    { n: "02", title: "Агент читает контекст", desc: "Учитывает историю переписки и формирует следующий ход." },
    { n: "03", title: "Получаете черновик", desc: "Короткое сообщение + понятный следующий шаг." },
    { n: "04", title: "Подтверждаете отправку", desc: "Без вашего «ОК» ничего не уйдёт адресату." },
  ];
  return (
    <section id="how" className="py-28 px-6 bg-gradient-soft">
      <div className="max-w-7xl mx-auto">
        <SectionTitle kicker="Как это работает" title="Как агент ведёт диалог" subtitle="Всё управление — в Telegram. Агент предлагает, вы подтверждаете." />
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {steps.map((s, i) => (
            <motion.div key={i} {...fadeUp} transition={{ duration: 0.6, delay: i * 0.1 }} className="relative p-8 rounded-3xl bg-card shadow-soft">
              <div className="text-5xl font-display font-bold text-gradient mb-4">{s.n}</div>
              <h3 className="font-display font-semibold text-xl mb-2">{s.title}</h3>
              <p className="text-muted-foreground">{s.desc}</p>
            </motion.div>
          ))}
        </div>
        <motion.div {...fadeUp} className="mt-12 p-8 rounded-3xl bg-card border border-border shadow-elegant text-center text-muted-foreground">
          <MessageSquare className="w-10 h-10 mx-auto mb-3 text-primary" />
          <div className="text-sm space-y-2">
            <div className="font-medium text-foreground/90">Нет автоотправки.</div>
            <div>Comrade AI всегда показывает черновик перед отправкой.</div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="py-28 px-6">
      <div className="max-w-5xl mx-auto">
        <SectionTitle
          kicker="Тариф"
          title="Пробный день и помесячная подписка"
          subtitle="Регистрация на сайте — 1 день бесплатно с полным доступом к кабинету и подключению личного Telegram. Дальше — 500 ₽ за месяц, оплата через ЮKassa / ЮMoney."
        />
        <motion.div
          {...fadeUp}
          className="rounded-[2rem] bg-card border border-border shadow-elegant p-10 md:p-14 flex flex-col md:flex-row md:items-center md:justify-between gap-8"
        >
          <div className="flex items-start gap-5">
            <div className="w-14 h-14 rounded-2xl bg-gradient-primary grid place-items-center shrink-0 shadow-soft">
              <Wallet className="w-7 h-7 text-primary-foreground" />
            </div>
            <div>
              <h3 className="font-display font-bold text-2xl md:text-3xl mb-2">500 ₽ / месяц</h3>
              <ul className="text-muted-foreground space-y-2 text-sm md:text-base">
                <li className="flex gap-2">
                  <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <span><strong className="text-foreground">1 день бесплатно</strong> после регистрации на сайте</span>
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <span>Подключение личного Telegram, агенты и черновики с подтверждением отправки</span>
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <span>Оплата банковской картой и доступными способами через ЮKassa</span>
                </li>
              </ul>
            </div>
          </div>
          <a
            href={TG}
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-gradient-primary text-primary-foreground font-semibold shadow-soft hover:shadow-glow transition-all whitespace-nowrap"
          >
            <Send className="w-5 h-5" /> Начать в Telegram
          </a>
        </motion.div>
        <p className="text-center text-sm text-muted-foreground mt-8 max-w-2xl mx-auto">
          Личный кабинет на сайте открывается после регистрации: там же видно срок триала и кнопку продления на месяц.
        </p>
      </div>
    </section>
  );
}

function UseCases() {
  const items = [
    { icon: MessageSquare, title: "Дожать отчёт / статус", desc: "Спросить, уточнить сроки и вернуться к вопросу, если нет ответа." },
    { icon: Calendar, title: "Согласовать встречу", desc: "Уточнить время, собрать подтверждение и зафиксировать договорённость." },
    { icon: Inbox, title: "Собрать документы", desc: "Попросить файл/ссылку/данные и мягко напомнить, если задерживают." },
    { icon: Bell, title: "Вернуться к договорённости", desc: "Не забыть, что обещали, и вовремя напомнить о следующем шаге." },
    { icon: Target, title: "Сопроводить дедлайн", desc: "Держать задачу под контролем до выполнения и закрыть её результатом." },
    { icon: Search, title: "Разгрузить поток", desc: "Сводка важного из переписок и уведомления “что делать сегодня”.", badge: "Скоро" },
  ];
  return (
    <section className="py-28 px-6">
      <div className="max-w-7xl mx-auto">
        <SectionTitle title="Где это особенно полезно" />
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((it, i) => <Card key={i} {...it} />)}
        </div>
      </div>
    </section>
  );
}

function Security() {
  const points = [
    "Черновик перед отправкой — всегда (без автоотправки).",
    "Подключение Telegram нужно, чтобы агент работал в ваших диалогах.",
    "Вы управляете сохранёнными данными.",
    "Можно удалять заметки, задачи и историю в любой момент.",
    "Автоматизация строится вокруг безопасности и прозрачности.",
  ];
  return (
    <section className="py-28 px-6 bg-gradient-soft">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
        <motion.div {...fadeUp}>
          <div className="w-20 h-20 rounded-3xl bg-gradient-primary grid place-items-center shadow-glow mb-6">
            <Shield className="w-10 h-10 text-primary-foreground" />
          </div>
          <h2 className="text-4xl md:text-5xl font-bold mb-5">Вы полностью контролируете отправку</h2>
          <p className="text-lg text-muted-foreground">Агент ведёт диалог и предлагает следующий шаг, но не отправляет сообщения без подтверждения.</p>
        </motion.div>
        <motion.ul {...fadeUp} className="space-y-3">
          {points.map((p, i) => (
            <li key={i} className="flex items-start gap-3 p-5 rounded-2xl bg-card border border-border shadow-soft">
              <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <span className="text-foreground/90">{p}</span>
            </li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}

function Roadmap() {
  const steps = [
    { icon: Send, title: "Telegram MVP", desc: "Агенты для диалогов + черновики + подтверждение отправки." },
    { icon: Globe, title: "WhatsApp, MAX, Avito", desc: "Подключение новых каналов общения и задач." },
    { icon: Inbox, title: "Email и посты", desc: "Работа с письмами, обновлениями, постами и информационным потоком." },
    { icon: LayoutDashboard, title: "Единый web-интерфейс", desc: "Один кабинет для всех коммуникаций, задач, заметок и отчётов." },
  ];
  return (
    <section id="roadmap" className="py-28 px-6">
      <div className="max-w-7xl mx-auto">
        <SectionTitle kicker="Куда развивается продукт" title="От Telegram-бота к единому центру коммуникаций" subtitle="Telegram — первый канал запуска. Далее Comrade AI расширится в другие мессенджеры и единый web-интерфейс." />
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {steps.map((s, i) => (
            <motion.div key={i} {...fadeUp} transition={{ duration: 0.6, delay: i * 0.1 }} className="relative p-6 rounded-3xl bg-card border border-border shadow-soft">
              <div className="text-xs font-medium text-muted-foreground mb-3">Шаг {i + 1}</div>
              <div className="w-11 h-11 rounded-2xl bg-gradient-primary grid place-items-center mb-4">
                <s.icon className="w-5 h-5 text-primary-foreground" />
              </div>
              <h3 className="font-display font-semibold text-lg mb-2">{s.title}</h3>
              <p className="text-sm text-muted-foreground">{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ForWhom() {
  const items = [
    { icon: Rocket, label: "Предприниматели" },
    { icon: Briefcase, label: "Руководители" },
    { icon: Target, label: "Продажи" },
    { icon: Users, label: "Проектные команды" },
    { icon: Sparkles, label: "Фрилансеры" },
    { icon: CheckCircle2, label: "Занятые специалисты" },
  ];
  return (
    <section className="py-28 px-6 bg-gradient-soft">
      <div className="max-w-6xl mx-auto">
        <SectionTitle title="Для тех, кто много общается и не хочет терять важное" subtitle="Comrade AI особенно полезен тем, у кого каждый день много сообщений, договорённостей, задач и напоминаний." />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {items.map((it, i) => (
            <motion.div key={i} {...fadeUp} transition={{ duration: 0.5, delay: i * 0.05 }} className="p-6 rounded-2xl bg-card border border-border shadow-soft flex items-center gap-3 hover:border-primary transition">
              <div className="w-10 h-10 rounded-xl bg-gradient-primary grid place-items-center">
                <it.icon className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-medium">{it.label}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const qa = [
    { q: "Сколько стоит и есть ли пробный период?", a: "После регистрации на сайте — 1 день бесплатного доступа. Затем подписка 500 ₽ за месяц; оплата через ЮKassa / ЮMoney в личном кабинете. Досрочно оплатить месяц можно и во время триала." },
    { q: "Comrade AI ведёт диалоги за меня?", a: "Он ведёт диалог как агент: читает контекст, предлагает следующий шаг и готовит текст. Отправка — только после вашего подтверждения." },
    { q: "Это автоответчик?", a: "Нет. Это агенты под конкретную цель (контакт/задача), которые действуют по контексту и сценарию. Автоотправки нет." },
    { q: "Что нужно, чтобы агент работал в моих диалогах?", a: "Нужно один раз подключить Telegram через /connect — чтобы видеть ваши диалоги и готовить ответы по контексту." },
    { q: "Это только Telegram-бот?", a: "Нет. Telegram — первый этап. Далее планируется WhatsApp, MAX, Avito, Email и единый web-интерфейс." },
    { q: "Можно ли удалять данные?", a: "Да. Вы можете управлять своими заметками, задачами и сохранённой информацией." },
    { q: "Что будет дальше?", a: "Развитие мультиплатформенности, web-кабинет, обработка постов и сообщений, выделение главного и персональные отчёты." },
  ];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="py-28 px-6">
      <div className="max-w-3xl mx-auto">
        <SectionTitle title="Частые вопросы" />
        <div className="space-y-3">
          {qa.map((item, i) => (
            <motion.div key={i} {...fadeUp} className="rounded-2xl bg-card border border-border shadow-soft overflow-hidden">
              <button onClick={() => setOpen(open === i ? null : i)} className="w-full p-6 flex items-center justify-between gap-4 text-left">
                <span className="font-display font-semibold">{item.q}</span>
                <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform shrink-0 ${open === i ? "rotate-180" : ""}`} />
              </button>
              {open === i && (
                <div className="px-6 pb-6 text-muted-foreground animate-fade-up">{item.a}</div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="py-28 px-6">
      <motion.div {...fadeUp} className="max-w-5xl mx-auto rounded-[2.5rem] bg-gradient-primary p-12 md:p-20 text-center shadow-elegant relative overflow-hidden">
        <div className="absolute inset-0 opacity-30" style={{ background: "radial-gradient(circle at 30% 30%, white, transparent 50%)" }} />
        <div className="relative">
          <h2 className="text-4xl md:text-6xl font-bold text-primary-foreground mb-5">Запустите первого агента за 2 минуты</h2>
          <p className="text-lg text-primary-foreground/90 max-w-xl mx-auto mb-8">Опишите цель — получите первый черновик — подтвердите отправку.</p>
          <a href={TG} className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-card text-foreground font-semibold shadow-elegant hover:scale-105 transition-transform">
            <Send className="w-5 h-5" /> Попробовать в Telegram
          </a>
        </div>
      </motion.div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border py-10 px-6">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-primary grid place-items-center">
            <Bot className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-display font-semibold text-foreground">Comrade AI</span>
        </div>
        <div>© {new Date().getFullYear()} Comrade AI. Все права защищены.</div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Pricing />
        <UseCases />
        <Security />
        <Roadmap />
        <ForWhom />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}

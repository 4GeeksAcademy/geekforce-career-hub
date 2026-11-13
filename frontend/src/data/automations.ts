/**
 * Automations catalog for the "Automations" page (admins and advisors, read-only).
 *
 * This file IS the content: edit it to change a card, then deploy. Every text is { es, en }.
 * Written from the real code, not from memory:
 *   - GitHub Actions flows: repo 4GAES/GF_Automations (services/<name>/index.js, .github/workflows/*.yml)
 *   - Career Hub flows: backend/app/jobs.py, notion_sync.py, job_radar.py, events.py, routers/jobs_routes.py
 * When one of those changes, update its card here (docs/AUTOMATIONS.md explains how).
 *
 * Phase 3 (docs/AUTOMATIONS.md) adds live status: last run, result and log link for each card.
 */

export type Tx = { es: string; en: string };
const x = (es: string, en: string): Tx => ({ es, en });

export type Platform = "github" | "hub";
export type Channel = "slack" | "email" | "inapp" | "none" | "activecampaign" | "webhook";

/** days: 1 = Monday … 7 = Sunday. time is in `tz` (GitHub cron runs in UTC; Career Hub uses its TIMEZONE). */
export type Schedule = { days: number[]; time: string; tz: "UTC" | "America/New_York" };

export type Trigger =
  | { kind: "schedule"; schedule: Schedule; after?: string }
  | { kind: "event"; label: Tx };

export type Rule = { when: Tx; then: Tx; tag?: string };
export type Risk = { level: "ok" | "warn" | "risk"; text: Tx };

export type DNode =
  | { t: "start"; label: Tx }
  | { t: "step"; label: Tx; kind?: "read" | "write" | "send" | "calc" }
  | { t: "decision"; label: Tx; branches: { label: Tx; nodes: DNode[] }[] }
  | { t: "end"; label: Tx }
  | { t: "error"; label: Tx }
  | { t: "link"; to: string; label: Tx };

export type Automation = {
  id: string;
  name: Tx;
  short: Tx;
  platform: Platform;
  trigger: Trigger;
  manual?: Tx;
  what: Tx;
  audience: Tx[];
  rules?: Rule[];
  channels: Channel[];
  writes: Tx[];
  errors: Risk[];
  notes?: Tx[];
  source: { repo: string; files: string[]; url?: string };
  diagram: DNode[];
};

export type EdgeKind = "feeds" | "runs_before" | "data" | "similar";
export type Edge = { from: string; to: string; kind: EdgeKind; label: Tx };

const GF_REPO = "https://github.com/4GAES/GF_Automations";
const HUB_REPO = "https://github.com/4GeeksAcademy/geekforce-career-hub";

const FAIL_ALERT: Risk = {
  level: "risk",
  text: x("Si la ejecución falla, GitHub la marca en rojo en la pestaña Actions. El aviso automático por n8n hoy no llega: el paso «Notificar fallo» usa una variable que no está definida en ese paso.",
    "If the run fails, GitHub marks it red in the Actions tab. The automatic n8n alert doesn't arrive today: the «Notify failure» step uses a variable that isn't set in that step."),
};
const RETRIES: Risk = {
  level: "ok",
  text: x("El envío a n8n se reintenta 3 veces (a los 2, 5 y 10 segundos) antes de darse por fallido.",
    "Sending to n8n is retried 3 times (after 2, 5 and 10 seconds) before it counts as failed."),
};
const UTC_NOTE = x("El horario de GitHub está fijo en UTC: en horario de verano corre a la hora indicada en España, y en invierno una hora antes.",
  "GitHub schedules are fixed in UTC: in Spanish summer time it runs at the listed hour, in winter one hour earlier.");
const HUB_LOG_ONLY: Risk = {
  level: "warn",
  text: x("Si algo falla, queda solo en los logs del servidor (Railway). Nadie recibe un aviso automático.",
    "If something fails it's only in the server logs (Railway). Nobody gets an automatic alert."),
};
const IDEMPOTENT: Risk = {
  level: "ok",
  text: x("Es segura de repetir: cada cobro o premio tiene una clave única, así que correrla dos veces nunca cobra doble.",
    "Safe to repeat: each charge or bonus has a unique key, so running it twice never charges twice."),
};
const HUB_MANUAL = x("Un admin puede correrla a mano en Gestionar → Solicitudes de pausa → «Tareas programadas».",
  "An admin can run it by hand in Manage → Pause requests → «Scheduled checks».");

export const AUTOMATIONS: Automation[] = [
  // ───────────────────────────── GitHub Actions (Spain) ─────────────────────────────
  {
    id: "not-started",
    platform: "github",
    name: x("Not Started", "Not Started"),
    short: x("Escribe por Slack a quienes todavía no empezaron Career Support y, si no responden, los pasa a Missing.",
      "Messages students who haven't started Career Support on Slack and, if they don't answer, moves them to Missing."),
    trigger: { kind: "schedule", schedule: { days: [5], time: "10:00", tz: "UTC" } },
    manual: x("En GitHub → Actions → «Orquestador Viernes» → Run workflow.", "In GitHub → Actions → «Orquestador Viernes» → Run workflow."),
    what: x("Cada viernes busca en Notion a los estudiantes de España que terminaron el curso hace más de 14 días y aún no empezaron el proceso. Les manda hasta dos mensajes por Slack, de parte de su coach. Si después de los dos mensajes siguen sin responder, cambia su estado a Missing.",
      "Every Friday it looks in Notion for Spain students who finished the course more than 14 days ago and haven't started the process. It sends them up to two Slack messages from their coach. If they still don't answer after both, it changes their status to Missing."),
    audience: [
      x("GeekFORCE Stage = Not started", "GeekFORCE Stage = Not started"),
      x("Placement status = To be placed", "Placement status = To be placed"),
      x("Más de 14 días desde el fin del curso (Days until placed > 14)", "More than 14 days since the course ended (Days until placed > 14)"),
      x("Último contacto hace más de 14 días", "Last contact more than 14 days ago"),
      x("3 proyectos o menos sin entregar", "3 or fewer projects not delivered"),
      x("Academy = 6-Spain", "Academy = 6-Spain"),
      x("Se salta a quien ya está en Missing o Not attended", "Skips anyone already in Missing or Not attended"),
    ],
    rules: [
      { when: x("No tiene ningún mensaje anterior", "No previous message"), then: x("Envía el Mensaje 1: pasos para preparar CV, LinkedIn y GitHub", "Sends Message 1: steps to prepare resume, LinkedIn and GitHub"), tag: "NS - Message 1" },
      { when: x("Ya recibió el Mensaje 1 y no respondió en los últimos 21 días", "Got Message 1 and didn't answer in the last 21 days"), then: x("Envía el Mensaje 2: recordatorio con urgencia y plazos", "Sends Message 2: reminder with urgency and deadlines"), tag: "NS - Message 2" },
      { when: x("Ya recibió el Mensaje 1 y respondió en los últimos 21 días", "Got Message 1 and answered in the last 21 days"), then: x("No hace nada esta semana", "Does nothing this week") },
      { when: x("Ya recibió los Mensajes 1 y 2", "Already got Messages 1 and 2"), then: x("Cambia Placement status a Missing, sin enviar mensaje", "Changes Placement status to Missing, no message"), tag: "Changed to Missing" },
    ],
    channels: ["slack"],
    writes: [
      x("Last Contact → hoy (cuando envía mensaje)", "Last Contact → today (when it sends a message)"),
      x("GF Follow up → agrega la etiqueta del paso", "GF Follow up → adds the step's tag"),
      x("Placement status → Missing (solo en el último paso)", "Placement status → Missing (last step only)"),
    ],
    errors: [
      { level: "warn", text: x("Si no puede actualizar Notion para un estudiante, lo anota en el log y sigue con los demás. El mensaje de ese estudiante se envía igual.",
        "If it can't update Notion for a student, it logs it and moves on. That student's message is still sent.") },
      RETRIES,
      { level: "risk", text: x("Primero actualiza Notion y al final envía todos los mensajes juntos. Si n8n no responde, el estudiante queda etiquetado como contactado sin haber recibido nada.",
        "It updates Notion first and sends all messages together at the end. If n8n doesn't answer, the student is tagged as contacted without receiving anything.") },
      FAIL_ALERT,
    ],
    notes: [
      x("Corre justo antes de Missing. Quien pasa a Missing aquí puede recibir el primer email de Missing ese mismo viernes.",
        "Runs right before Missing. Someone moved to Missing here can get Missing's first email that same Friday."),
      x("El texto de los mensajes está escrito en el código del servicio. Cambiarlo requiere un cambio técnico.",
        "The message text is written in the service code. Changing it needs a technical change."),
      UTC_NOTE,
    ],
    source: { repo: "GF_Automations", url: GF_REPO, files: ["services/not-started/index.js", ".github/workflows/orquestador-viernes.yml"] },
    diagram: [
      { t: "start", label: x("Viernes 10:00 UTC · Orquestador Viernes", "Friday 10:00 UTC · Friday orchestrator") },
      { t: "step", kind: "read", label: x("Busca en Notion: España, Not started, To be placed, sin contacto hace 14+ días", "Searches Notion: Spain, Not started, To be placed, no contact in 14+ days") },
      { t: "decision", label: x("¿Qué mensajes recibió?", "Which messages did they get?"), branches: [
        { label: x("Ninguno", "None"), nodes: [
          { t: "step", kind: "send", label: x("Mensaje 1 por Slack (CV, LinkedIn, GitHub)", "Message 1 on Slack (resume, LinkedIn, GitHub)") },
          { t: "step", kind: "write", label: x("Etiqueta NS - Message 1 · Last Contact hoy", "Tag NS - Message 1 · Last Contact today") }] },
        { label: x("Solo el 1", "Only #1"), nodes: [
          { t: "decision", label: x("¿Respondió en 21 días?", "Answered within 21 days?"), branches: [
            { label: x("Sí", "Yes"), nodes: [{ t: "end", label: x("Espera a la próxima semana", "Waits until next week") }] },
            { label: x("No", "No"), nodes: [
              { t: "step", kind: "send", label: x("Mensaje 2 por Slack (urgencia)", "Message 2 on Slack (urgency)") },
              { t: "step", kind: "write", label: x("Etiqueta NS - Message 2", "Tag NS - Message 2") }] }] }] },
        { label: x("El 1 y el 2", "#1 and #2"), nodes: [
          { t: "step", kind: "write", label: x("Placement status → Missing · etiqueta Changed to Missing", "Placement status → Missing · tag Changed to Missing") },
          { t: "link", to: "missing", label: x("Entra al flujo Missing", "Enters the Missing flow") }] },
      ] },
      { t: "step", kind: "send", label: x("Envía todos los mensajes juntos a n8n (3 intentos)", "Sends all messages together to n8n (3 tries)") },
      { t: "error", label: x("Si n8n falla: la ejecución queda en rojo, pero Notion ya se actualizó", "If n8n fails: the run turns red, but Notion was already updated") },
      { t: "link", to: "missing", label: x("Después corre Missing", "Then Missing runs") },
    ],
  },
  {
    id: "missing",
    platform: "github",
    name: x("Missing", "Missing"),
    short: x("Tres emails escalonados para quienes están en Missing. Al tercero sin respuesta, se da de baja.",
      "Three escalating emails for students in Missing. After the third with no answer, they're removed."),
    trigger: { kind: "schedule", schedule: { days: [5], time: "10:00", tz: "UTC" }, after: "not-started" },
    manual: x("En GitHub → Actions → «Orquestador Viernes» → Run workflow. Marcando «solo Missing» se salta Not Started.",
      "In GitHub → Actions → «Orquestador Viernes» → Run workflow. Tick «only Missing» to skip Not Started."),
    what: x("Cada viernes, justo después de Not Started, revisa a los estudiantes en Missing y avanza un paso en la escalada si no respondieron: primero un email amistoso, luego un último llamado con plazo de 7 días y, por último, el aviso de baja. Con el tercer email, el estado pasa a Not attended.",
      "Every Friday, right after Not Started, it checks students in Missing and moves one step up the ladder if they didn't answer: first a friendly email, then a last call with a 7-day deadline, and finally the removal notice. With the third email the status becomes Not attended."),
    audience: [
      x("Placement status = Missing", "Placement status = Missing"),
      x("Cohorte terminada hace menos de 1 año", "Cohort ended less than 1 year ago"),
      x("3 proyectos o menos sin entregar", "3 or fewer projects not delivered"),
      x("Academy = 6-Spain", "Academy = 6-Spain"),
    ],
    rules: [
      { when: x("Sin emails de Missing y sin respuesta en 30 días", "No Missing emails and no answer in 30 days"), then: x("Email 1: «¿Te gustaría retomar GeekFORCE?»", "Email 1: «Would you like to resume GeekFORCE?»"), tag: "Missing - Message 1" },
      { when: x("Tiene el email 1 y no respondió en 10 días", "Has email 1 and no answer in 10 days"), then: x("Email 2: «Último llamado» (plazo de 7 días)", "Email 2: «Last call» (7-day deadline)"), tag: "Missing - Message 2" },
      { when: x("Tiene los emails 1 y 2 y no respondió en 10 días", "Has emails 1 and 2 and no answer in 10 days"), then: x("Email 3: «Baja del servicio» y Placement status → Not attended", "Email 3: «Removed from the service» and Placement status → Not attended"), tag: "Missing - Message 3" },
      { when: x("Respondió hace poco, o ya tiene los 3 emails", "Answered recently, or already has all 3 emails"), then: x("No hace nada", "Does nothing") },
    ],
    channels: ["email"],
    writes: [
      x("Last Contact → hoy", "Last Contact → today"),
      x("GF Follow up → agrega la etiqueta del email enviado", "GF Follow up → adds the tag of the email sent"),
      x("Placement status → Not attended (con el email 3)", "Placement status → Not attended (with email 3)"),
    ],
    errors: [
      { level: "warn", text: x("Si falla con un estudiante, lo anota y sigue. Al final la ejecución queda en rojo para que se revise.",
        "If it fails for one student, it logs it and moves on. At the end the run turns red so someone checks it.") },
      RETRIES,
      { level: "risk", text: x("Actualiza Notion estudiante por estudiante y envía los emails todos juntos al final. Si n8n falla, las etiquetas quedan puestas pero los emails no salen, y el viernes siguiente avanza al paso siguiente.",
        "It updates Notion student by student and sends all emails together at the end. If n8n fails, tags are set but no email goes out, and next Friday it moves to the next step."), },
      { level: "ok", text: x("Si Not Started falla, Missing corre igual.", "If Not Started fails, Missing still runs.") },
      FAIL_ALERT,
    ],
    notes: [
      x("En la práctica, sin respuesta: email 1 un viernes, email 2 el viernes siguiente y baja al tercer viernes. No mira cuánto pasó desde el email anterior, solo la última respuesta.",
        "In practice, with no answer: email 1 one Friday, email 2 the next Friday and removal on the third Friday. It doesn't look at the time since the previous email, only at the last answer."),
      x("Los emails van firmados con el nombre del coach (GeekFORCE Coach en Notion).", "Emails are signed with the coach's name (GeekFORCE Coach in Notion)."),
      UTC_NOTE,
    ],
    source: { repo: "GF_Automations", url: GF_REPO, files: ["services/missing/index.js", ".github/workflows/orquestador-viernes.yml"] },
    diagram: [
      { t: "start", label: x("Viernes, cuando termina Not Started", "Friday, after Not Started ends") },
      { t: "step", kind: "read", label: x("Busca en Notion: España, Missing, cohorte de hace menos de 1 año", "Searches Notion: Spain, Missing, cohort under 1 year old") },
      { t: "decision", label: x("¿Respondió hace poco?", "Answered recently?"), branches: [
        { label: x("Sí", "Yes"), nodes: [{ t: "end", label: x("Espera", "Waits") }] },
        { label: x("No", "No"), nodes: [
          { t: "decision", label: x("¿Qué emails tiene?", "Which emails does it have?"), branches: [
            { label: x("Ninguno", "None"), nodes: [{ t: "step", kind: "send", label: x("Email 1 · reactivación", "Email 1 · re-engage") }] },
            { label: x("El 1", "#1"), nodes: [{ t: "step", kind: "send", label: x("Email 2 · último llamado (7 días)", "Email 2 · last call (7 days)") }] },
            { label: x("El 1 y el 2", "#1 and #2"), nodes: [
              { t: "step", kind: "send", label: x("Email 3 · baja", "Email 3 · removal") },
              { t: "step", kind: "write", label: x("Placement status → Not attended", "Placement status → Not attended") },
              { t: "end", label: x("Fin del seguimiento", "Follow-up ends") }] },
          ] },
          { t: "step", kind: "write", label: x("Etiqueta del email · Last Contact hoy", "Email tag · Last Contact today") }] },
      ] },
      { t: "step", kind: "send", label: x("Envía todos los emails juntos a n8n (3 intentos)", "Sends all emails together to n8n (3 tries)") },
      { t: "error", label: x("Si algún estudiante falló o n8n no responde: ejecución en rojo", "If a student failed or n8n doesn't answer: run turns red") },
    ],
  },
  {
    id: "stage1-2",
    platform: "github",
    name: x("Stage 1 y 2", "Stage 1 & 2"),
    short: x("Seguimiento por Slack a quienes llevan demasiado tiempo en Stage 1 (perfil) o Stage 2 (entrevistas).",
      "Slack follow-up for students stuck too long in Stage 1 (profile) or Stage 2 (interviews)."),
    trigger: { kind: "schedule", schedule: { days: [4], time: "08:00", tz: "UTC" } },
    manual: x("En GitHub → Actions → «stage1-2» → Run workflow.", "In GitHub → Actions → «stage1-2» → Run workflow."),
    what: x("Cada jueves revisa a los graduados de España en Stage 1 o Stage 2. Según cuántos días llevan en la etapa y cuánto hace que nadie los contacta, les manda un mensaje de seguimiento, una alerta de estancamiento o, si ya pasó demasiado tiempo, los pasa a Missing.",
      "Every Thursday it checks Spain graduates in Stage 1 or Stage 2. Depending on how many days they've been in the stage and how long since anyone contacted them, it sends a follow-up, a stalled alert or, if too much time has passed, moves them to Missing."),
    audience: [
      x("Placement status = To be placed", "Placement status = To be placed"),
      x("Educational Status = Graduated", "Educational Status = Graduated"),
      x("Academy = 6-Spain", "Academy = 6-Spain"),
      x("Solo quienes están en Stage 1 o Stage 2", "Only students in Stage 1 or Stage 2"),
    ],
    rules: [
      { when: x("Stage 1 · 15 a 29 días en la etapa · sin contacto hace 20+ días", "Stage 1 · 15–29 days in stage · no contact in 20+ days"), then: x("Seguimiento con el link de agenda de su coach", "Follow-up with the coach's booking link"), tag: "ST1 - Message 1" },
      { when: x("Stage 2 · 15 a 29 días · sin contacto hace 20+ días", "Stage 2 · 15–29 days · no contact in 20+ days"), then: x("Seguimiento", "Follow-up"), tag: "ST2 - Message 1" },
      { when: x("Stage 1 · 30 a 45 días · sin contacto hace 20+ días · faltan más de 2 meses para el fin de cohorte", "Stage 1 · 30–45 days · no contact in 20+ days · more than 2 months to cohort end"), then: x("Alerta de estancamiento", "Stalled alert"), tag: "ST1 - Msg 2" },
      { when: x("Stage 2 · 45 a 60 días · sin contacto hace 20+ días · faltan más de 2 meses para el fin de cohorte", "Stage 2 · 45–60 days · no contact in 20+ days · more than 2 months to cohort end"), then: x("Alerta de estancamiento", "Stalled alert"), tag: "ST2 - Msg 2" },
      { when: x("Stage 1 · más de 45 días · sin contacto hace 30+ días · ya recibió el seguimiento", "Stage 1 · over 45 days · no contact in 30+ days · already got the follow-up"), then: x("Placement status → Missing, sin mensaje", "Placement status → Missing, no message") },
      { when: x("Stage 2 · más de 60 días · sin contacto hace 30+ días · ya recibió el seguimiento", "Stage 2 · over 60 days · no contact in 30+ days · already got the follow-up"), then: x("Placement status → Missing, sin mensaje", "Placement status → Missing, no message") },
    ],
    channels: ["slack"],
    writes: [
      x("Last Contact → hoy (cuando envía mensaje)", "Last Contact → today (when it sends a message)"),
      x("GF Follow up → agrega la etiqueta del mensaje", "GF Follow up → adds the message tag"),
      x("Placement status → Missing (cambios de estado)", "Placement status → Missing (status changes)"),
    ],
    errors: [
      { level: "ok", text: x("Primero envía los mensajes y solo después actualiza Notion. Si n8n falla, Notion no se toca y el jueves siguiente lo intenta de nuevo.",
        "It sends the messages first and only then updates Notion. If n8n fails, Notion is untouched and next Thursday it tries again.") },
      RETRIES,
      { level: "warn", text: x("Si no puede actualizar Notion para un estudiante, lo anota en el log y la ejecución termina en verde igual.",
        "If it can't update Notion for a student, it logs it and the run still ends green.") },
      { level: "risk", text: x("Posible error: para pasar a Missing escribe Placement status como «select», mientras los demás flujos lo escriben como «status». Si Notion lo rechaza, el cambio no se aplica y solo queda en el log. Conviene revisarlo en los logs de GitHub.",
        "Possible bug: to move to Missing it writes Placement status as «select», while the other flows write it as «status». If Notion rejects it, the change doesn't happen and only shows in the log. Worth checking in the GitHub logs.") },
      FAIL_ALERT,
    ],
    notes: [
      x("La alerta de estancamiento solo sale si faltan más de 2 meses para la «Cohort end date». Si esa fecha ya pasó, esa alerta no se envía.",
        "The stalled alert only goes out if there are more than 2 months left to the «Cohort end date». If that date already passed, it isn't sent."),
      x("El link de agenda sale de config/coaches.json. Si el coach no está en la lista, usa calendly.com/4geeksacademy.",
        "The booking link comes from config/coaches.json. If the coach isn't listed, it uses calendly.com/4geeksacademy."),
      UTC_NOTE,
    ],
    source: { repo: "GF_Automations", url: GF_REPO, files: ["services/stage1-2/index.js", "config/coaches.json", ".github/workflows/stage1-2.yml"] },
    diagram: [
      { t: "start", label: x("Jueves 08:00 UTC", "Thursday 08:00 UTC") },
      { t: "step", kind: "read", label: x("Busca graduados de España, To be placed, en Stage 1 o 2", "Finds Spain graduates, To be placed, in Stage 1 or 2") },
      { t: "decision", label: x("¿Cuántos días en la etapa?", "How many days in the stage?"), branches: [
        { label: x("15–29", "15–29"), nodes: [
          { t: "step", kind: "send", label: x("Seguimiento por Slack (si 20+ días sin contacto)", "Slack follow-up (if 20+ days without contact)") },
          { t: "step", kind: "write", label: x("Etiqueta ST1/ST2 - Message 1", "Tag ST1/ST2 - Message 1") }] },
        { label: x("S1 30–45 · S2 45–60", "S1 30–45 · S2 45–60"), nodes: [
          { t: "step", kind: "send", label: x("Alerta de estancamiento (si faltan 2+ meses de cohorte)", "Stalled alert (if 2+ months of cohort left)") },
          { t: "step", kind: "write", label: x("Etiqueta ST1/ST2 - Msg 2", "Tag ST1/ST2 - Msg 2") }] },
        { label: x("S1 >45 · S2 >60", "S1 >45 · S2 >60"), nodes: [
          { t: "step", kind: "write", label: x("Placement status → Missing (si 30+ días sin contacto)", "Placement status → Missing (if 30+ days without contact)") },
          { t: "link", to: "missing", label: x("Entra al flujo Missing", "Enters the Missing flow") }] },
      ] },
      { t: "step", kind: "send", label: x("1º envía los mensajes a n8n", "1st sends messages to n8n") },
      { t: "step", kind: "write", label: x("2º actualiza Notion", "2nd updates Notion") },
      { t: "error", label: x("Si n8n falla: no toca Notion y reintenta el jueves siguiente", "If n8n fails: leaves Notion untouched and retries next Thursday") },
    ],
  },
  {
    id: "on-hold",
    platform: "github",
    name: x("On Hold", "On Hold"),
    short: x("Recuerda por email el fin de la pausa y, si no hay respuesta, pasa al estudiante a Not attended.",
      "Emails a reminder when the pause ends and, with no answer, moves the student to Not attended."),
    trigger: { kind: "schedule", schedule: { days: [1, 2, 3, 4, 5, 6, 7], time: "09:00", tz: "UTC" } },
    manual: x("En GitHub → Actions → «on-hold» → Run workflow.", "In GitHub → Actions → «on-hold» → Run workflow."),
    what: x("Todos los días revisa a los estudiantes de España en pausa (On hold). Cuenta los días desde su fecha «On Hold until». Al quinto día les manda un email para que retomen. Si al día 10 o después siguen sin contacto, cambia su estado a Not attended.",
      "Every day it checks Spain students on pause (On hold). It counts the days since their «On Hold until» date. On day 5 it emails them to resume. If on day 10 or later there's still no contact, it changes their status to Not attended."),
    audience: [
      x("Placement status = On hold u On hold (long term)", "Placement status = On hold or On hold (long term)"),
      x("Academy = 6-Spain", "Academy = 6-Spain"),
      x("Con fecha «On Hold until» cargada", "With an «On Hold until» date"),
    ],
    rules: [
      { when: x("Exactamente 5 días después de «On Hold until»", "Exactly 5 days after «On Hold until»"), then: x("Email recordatorio para retomar (plazo de 10 días)", "Reminder email to resume (10-day deadline)"), tag: "Email-on-hold" },
      { when: x("10 días o más después · tiene Email-on-hold · sin contacto hace más de 14 días", "10+ days after · has Email-on-hold · no contact for over 14 days"), then: x("Placement status → Not attended, sin mensaje", "Placement status → Not attended, no message") },
      { when: x("Cualquier otro caso", "Any other case"), then: x("No hace nada", "Does nothing") },
    ],
    channels: ["email"],
    writes: [
      x("GF Follow up → se REEMPLAZA por solo «Email-on-hold» (borra las demás etiquetas)", "GF Follow up → REPLACED by just «Email-on-hold» (other tags are erased)"),
      x("Last Contact → hoy (día 5)", "Last Contact → today (day 5)"),
      x("Placement status → Not attended (día 10+)", "Placement status → Not attended (day 10+)"),
    ],
    errors: [
      { level: "warn", text: x("Si falla con un estudiante, lo anota en el log y sigue. La ejecución termina en verde igual.",
        "If it fails for a student, it logs it and moves on. The run still ends green.") },
      RETRIES,
      { level: "risk", text: x("Actualiza Notion antes de enviar los emails. Si n8n falla, el estudiante queda con la etiqueta pero sin email, y días después puede pasar a Not attended sin haber recibido el aviso.",
        "It updates Notion before sending the emails. If n8n fails, the student keeps the tag without the email, and days later can move to Not attended without the notice."), },
      { level: "risk", text: x("La condición es «exactamente 5 días». Si la ejecución de ese día falla, el estudiante nunca recibe el email y, sin la etiqueta, tampoco pasa a Not attended.",
        "The condition is «exactly 5 days». If that day's run fails, the student never gets the email and, without the tag, never moves to Not attended.") },
      FAIL_ALERT,
    ],
    notes: [
      x("El email dice «en 5 días finaliza el período on hold», pero se envía 5 días DESPUÉS de la fecha «On Hold until». Conviene revisar el texto o la regla con el equipo.",
        "The email says «your on-hold period ends in 5 days», but it's sent 5 days AFTER the «On Hold until» date. Worth reviewing the text or the rule with the team."),
      x("Al reemplazar las etiquetas, se pierde el historial: si el estudiante vuelve a Stage 1/2 o a Missing, esos flujos no saben qué mensajes ya recibió.",
        "Replacing the tags loses the history: if the student goes back to Stage 1/2 or Missing, those flows don't know which messages they already got."),
      UTC_NOTE,
    ],
    source: { repo: "GF_Automations", url: GF_REPO, files: ["services/on-hold/index.js", ".github/workflows/on-hold.yml"] },
    diagram: [
      { t: "start", label: x("Todos los días 09:00 UTC", "Every day 09:00 UTC") },
      { t: "step", kind: "read", label: x("Busca en Notion: España, On hold / On hold (long term)", "Searches Notion: Spain, On hold / On hold (long term)") },
      { t: "step", kind: "calc", label: x("Cuenta días desde «On Hold until»", "Counts days since «On Hold until»") },
      { t: "decision", label: x("¿Cuántos días pasaron?", "How many days passed?"), branches: [
        { label: x("Exactamente 5", "Exactly 5"), nodes: [
          { t: "step", kind: "write", label: x("Etiquetas → solo Email-on-hold · Last Contact hoy", "Tags → only Email-on-hold · Last Contact today") },
          { t: "step", kind: "send", label: x("Email recordatorio", "Reminder email") }] },
        { label: x("10 o más", "10 or more"), nodes: [
          { t: "decision", label: x("¿Tiene Email-on-hold y 14+ días sin contacto?", "Has Email-on-hold and 14+ days without contact?"), branches: [
            { label: x("Sí", "Yes"), nodes: [{ t: "step", kind: "write", label: x("Placement status → Not attended", "Placement status → Not attended") }] },
            { label: x("No", "No"), nodes: [{ t: "end", label: x("Sin cambios", "No change") }] }] }] },
        { label: x("Otro", "Other"), nodes: [{ t: "end", label: x("Sin cambios", "No change") }] },
      ] },
      { t: "error", label: x("Si n8n falla: la etiqueta ya quedó puesta sin email", "If n8n fails: the tag is already set without the email") },
    ],
  },
  {
    id: "stage3",
    platform: "github",
    name: x("Stage 3", "Stage 3"),
    short: x("Envía por Slack los mensajes de acompañamiento programados para hoy en la base de mensajes de Notion.",
      "Sends on Slack the support messages scheduled for today in the Notion messages database."),
    trigger: { kind: "schedule", schedule: { days: [1, 2, 3, 4, 5, 6, 7], time: "10:30", tz: "UTC" } },
    manual: x("En GitHub → Actions → «stage3» → Run workflow (solo envía los mensajes con fecha de hoy).",
      "In GitHub → Actions → «stage3» → Run workflow (it only sends messages dated today)."),
    what: x("Para estudiantes en búsqueda activa (Stage 3). Los mensajes ya están escritos en una base de Notion aparte, cada uno con su fecha. Todos los días toma los de hoy, los envía por Slack de parte del coach, actualiza el último contacto del estudiante y archiva el mensaje para que no se repita.",
      "For students in active job search (Stage 3). The messages are already written in a separate Notion database, each with its date. Every day it takes today's, sends them on Slack from the coach, updates the student's last contact and archives the message so it isn't repeated."),
    audience: [
      x("Mensajes de la base de mensajes con scheduledDate = hoy", "Messages in the messages database with scheduledDate = today"),
      x("Solo los que tienen mensaje, Slack ID, coach y estudiante vinculado", "Only those with message, Slack ID, coach and linked student"),
    ],
    channels: ["slack"],
    writes: [
      x("Last Contact del estudiante → hoy", "Student's Last Contact → today"),
      x("Mensaje en la base de mensajes → archivado", "Message in the messages database → archived"),
    ],
    errors: [
      { level: "ok", text: x("Primero envía y después actualiza Notion: si n8n falla, no se archiva nada.", "It sends first and updates Notion after: if n8n fails, nothing is archived.") },
      RETRIES,
      { level: "risk", text: x("Solo mira los mensajes de HOY. Si la ejecución de un día falla, esos mensajes no se envían nunca, salvo que alguien la vuelva a correr ese mismo día.",
        "It only looks at TODAY's messages. If a day's run fails, those messages are never sent unless someone re-runs it that same day.") },
      { level: "warn", text: x("Un mensaje con algún campo vacío se salta sin aviso y queda en la base sin enviarse.", "A message with an empty field is skipped silently and stays in the database unsent.") },
      { level: "warn", text: x("Si no puede actualizar o archivar alguno, la ejecución termina en rojo (los mensajes ya se enviaron).", "If it can't update or archive one, the run ends red (the messages were already sent).") },
      FAIL_ALERT,
    ],
    notes: [
      x("Usa una base de Notion distinta a la de estudiantes (NOTION_MESSAGES_DB_ID).", "Uses a different Notion database from the students one (NOTION_MESSAGES_DB_ID)."),
      x("Por confirmar con el equipo: quién o qué carga los mensajes en esa base.", "To confirm with the team: who or what loads the messages into that database."),
      UTC_NOTE,
    ],
    source: { repo: "GF_Automations", url: GF_REPO, files: ["services/stage3/index.js", ".github/workflows/stage3.yml"] },
    diagram: [
      { t: "start", label: x("Todos los días 10:30 UTC", "Every day 10:30 UTC") },
      { t: "step", kind: "read", label: x("Lee la base de MENSAJES: los de fecha de hoy", "Reads the MESSAGES database: today's ones") },
      { t: "decision", label: x("¿Tiene todos los campos?", "All fields filled?"), branches: [
        { label: x("No", "No"), nodes: [{ t: "end", label: x("Se salta (queda sin enviar)", "Skipped (stays unsent)") }] },
        { label: x("Sí", "Yes"), nodes: [
          { t: "step", kind: "send", label: x("Envía todos por Slack vía n8n (3 intentos)", "Sends all on Slack via n8n (3 tries)") },
          { t: "step", kind: "write", label: x("Last Contact del estudiante → hoy", "Student's Last Contact → today") },
          { t: "step", kind: "write", label: x("Archiva el mensaje", "Archives the message") }] },
      ] },
      { t: "error", label: x("Si n8n falla: los mensajes de hoy no salen y mañana no se reintentan", "If n8n fails: today's messages don't go out and aren't retried tomorrow") },
    ],
  },

  // ───────────────────────────── Career Hub (Miami) ─────────────────────────────
  {
    id: "notion-sync",
    platform: "hub",
    name: x("Sincronización con Notion", "Notion sync"),
    short: x("Trae cada noche del Student Tracker de Notion a los estudiantes activos de GeekForce, con su etapa, plan, cohorte y coach.",
      "Every night brings the active GeekForce students from the Notion Student Tracker, with their stage, plan, cohort and coach."),
    trigger: { kind: "schedule", schedule: { days: [1, 2, 3, 4, 5, 6, 7], time: "00:30", tz: "America/New_York" } },
    manual: x("Botón «Sincronizar desde Notion» en Onboarding, o un admin en «Tareas programadas».", "«Sync from Notion» button in Onboarding, or an admin in «Scheduled checks»."),
    what: x("Notion es la fuente de verdad del roster. Cada noche el Hub lee el «Miami Student Tracker | Part-Time» y crea o actualiza a cada estudiante con GeekForce Status = Active. Los nuevos entran en Onboarding para que su coach los active. Durante el onboarding también importa una vez su historial de postulaciones.",
      "Notion is the source of truth for the roster. Every night the Hub reads the «Miami Student Tracker | Part-Time» and creates or updates every student with GeekForce Status = Active. New ones land in Onboarding for their coach to activate. During onboarding it also imports their application history once."),
    audience: [
      x("Filas del Miami Student Tracker con GeekForce Status = Active", "Miami Student Tracker rows with GeekForce Status = Active"),
      x("Solo corre si el Hub tiene NOTION_TOKEN configurado", "Only runs if the Hub has NOTION_TOKEN set"),
    ],
    rules: [
      { when: x("Estudiante nuevo", "New student"), then: x("Se crea en estado Onboarding (sin puntos todavía)", "Created in Onboarding status (no points yet)") },
      { when: x("Plan «Job Guarantee»", "«Job Guarantee» plan"), then: x("Tiene garantía de empleo", "Has the Job Guarantee") },
      { when: x("Plan «Regular Student» o «Special Scholarship»", "«Regular Student» or «Special Scholarship» plan"), then: x("Professional Support (sin garantía)", "Professional Support (no guarantee)") },
      { when: x("La etapa cambió en Notion desde la última vez", "The stage changed in Notion since last time"), then: x("Mueve la etapa en el Hub. Si no cambió, se respeta el cambio que hizo el coach en el Hub", "Moves the stage in the Hub. If it didn't change, the coach's change in the Hub stands") },
      { when: x("Marcado «Not to be Placed» en Notion", "Marked «Not to be Placed» in Notion"), then: x("El estudiante pasa a ese estado en el Hub", "The student moves to that status in the Hub") },
    ],
    channels: ["none"],
    writes: [
      x("Estudiantes, cohortes y coach asignado (por nombre)", "Students, cohorts and assigned coach (by name)"),
      x("Etapa, plan, fecha límite de la garantía", "Stage, plan, guarantee deadline"),
      x("Historial de postulaciones (una sola vez, sin puntos)", "Application history (once, no points)"),
      x("Un registro de cada sincronización (correcta o con errores)", "A record of each sync (ok or with errors)"),
    ],
    errors: [
      { level: "ok", text: x("Si falla un estudiante, se deshace solo ese y sigue con los demás. Los errores quedan en el registro de la sincronización.",
        "If one student fails, only that one is undone and the rest continue. Errors stay in the sync record.") },
      { level: "warn", text: x("Si no puede leer Notion, guarda la sincronización como fallida y no cambia nada.", "If it can't read Notion, it saves the sync as failed and changes nothing.") },
      { level: "ok", text: x("Es segura de repetir: busca a cada estudiante por su página de Notion y luego por email, sin duplicar.", "Safe to repeat: it finds each student by Notion page, then by email, without duplicating.") },
      HUB_LOG_ONLY,
    ],
    notes: [
      x("El coach se asigna por nombre: las cuentas de coach en el Hub deben llamarse igual que la opción «Advisor» de Notion.",
        "The coach is matched by name: coach accounts in the Hub must have the same name as the Notion «Advisor» option."),
      x("Lee el tracker de Miami. Las automatizaciones de GitHub trabajan con estudiantes de España.", "Reads the Miami tracker. The GitHub automations work with Spain students."),
    ],
    source: { repo: "geekforce-career-hub", url: HUB_REPO, files: ["backend/app/notion_sync.py", "backend/app/services/notion.py", "backend/app/jobs.py"] },
    diagram: [
      { t: "start", label: x("Cada noche 00:30 (hora de Miami) · o botón manual", "Every night 00:30 (Miami time) · or manual button") },
      { t: "step", kind: "read", label: x("Lee el Miami Student Tracker: GeekForce Status = Active", "Reads the Miami Student Tracker: GeekForce Status = Active") },
      { t: "decision", label: x("¿Ya existe en el Hub?", "Already in the Hub?"), branches: [
        { label: x("No", "No"), nodes: [
          { t: "step", kind: "write", label: x("Lo crea en Onboarding", "Creates it in Onboarding") },
          { t: "step", kind: "read", label: x("Importa su historial de postulaciones (sin puntos)", "Imports application history (no points)") }] },
        { label: x("Sí", "Yes"), nodes: [{ t: "step", kind: "write", label: x("Actualiza plan, cohorte, coach y fecha límite", "Updates plan, cohort, coach and deadline") }] },
      ] },
      { t: "decision", label: x("¿Cambió la etapa en Notion?", "Did the stage change in Notion?"), branches: [
        { label: x("Sí", "Yes"), nodes: [{ t: "link", to: "state-events", label: x("Mueve la etapa → evento de cambio", "Moves the stage → change event") }] },
        { label: x("No", "No"), nodes: [{ t: "end", label: x("Se respeta la etapa del Hub", "The Hub stage stands") }] },
      ] },
      { t: "step", kind: "write", label: x("Guarda el resultado de la sincronización", "Saves the sync result") },
      { t: "link", to: "daily", label: x("Los activos entran en los controles de cada noche", "Active ones enter the nightly checks") },
    ],
  },
  {
    id: "daily",
    platform: "hub",
    name: x("Controles diarios", "Daily checks"),
    short: x("Cada noche revisa pausas, actividad en LinkedIn y con reclutadores, inactividad y la escalera Not Started, y recalcula la garantía.",
      "Every night it checks pauses, LinkedIn and recruiter activity, inactivity and the Not Started ladder, and recalculates the guarantee."),
    trigger: { kind: "schedule", schedule: { days: [1, 2, 3, 4, 5, 6, 7], time: "01:00", tz: "America/New_York" } },
    manual: HUB_MANUAL,
    what: x("Es el control principal de la política de puntos. Termina las pausas vencidas y, para cada estudiante activo, aplica los descuentos automáticos por falta de actividad, avisa antes de que lleguen y recalcula si la garantía está asegurada, en riesgo o suspendida.",
      "It's the main points-policy check. It ends expired pauses and, for each active student, applies the automatic deductions for lack of activity, warns before they hit and recalculates whether the guarantee is secured, at risk or suspended."),
    audience: [x("Estudiantes activos con cuenta activa", "Active students with an active account"), x("Las pausas aprobadas que terminaron", "Approved pauses that ended")],
    rules: [
      { when: x("La pausa terminó ayer", "The pause ended yesterday"), then: x("La cierra y avisa «Bienvenido de vuelta»", "Closes it and sends «Welcome back»") },
      { when: x("Sin primera 1:1 · día 7 desde la activación", "No first 1:1 · day 7 after activation"), then: x("Aviso al estudiante y alerta al coach", "Notice to student and alert to coach") },
      { when: x("Sin primera 1:1 · día 15", "No first 1:1 · day 15"), then: x("Proceso «en espera» (se congelan los descuentos)", "Process «on hold» (deductions frozen)") },
      { when: x("Sin primera 1:1 · día 30", "No first 1:1 · day 30"), then: x("Garantía perdida (permanente)", "Guarantee lost (permanent)") },
      { when: x("14 días sin actividad en LinkedIn", "14 days without LinkedIn activity"), then: x("−10 puntos y aviso", "−10 points and notice") },
      { when: x("14 días sin contactar reclutadores", "14 days without recruiter outreach"), then: x("−10 puntos y aviso", "−10 points and notice") },
      { when: x("Día 25 sin actividad real", "Day 25 without real activity"), then: x("Aviso de inactividad", "Inactivity warning") },
      { when: x("Día 31 sin actividad, luego cada 7 días", "Day 31 without activity, then every 7 days"), then: x("−20 puntos y luego −10 cada semana · alerta al coach", "−20 points then −10 every week · alert to coach") },
      { when: x("Saldo por debajo de 60", "Balance below 60"), then: x("Garantía suspendida (permanente, solo un admin la reactiva)", "Guarantee suspended (permanent, only an admin can reinstate)") },
    ],
    channels: ["inapp", "email"],
    writes: [
      x("Puntos del estudiante (con motivo en su historial)", "Student points (with a reason in their ledger)"),
      x("Estado de la garantía", "Guarantee status"),
      x("Notificaciones al estudiante y alertas al coach", "Notifications to the student and alerts to the coach"),
    ],
    errors: [
      IDEMPOTENT,
      { level: "ok", text: x("Durante una pausa aprobada no se descuenta nada.", "Nothing is deducted during an approved pause.") },
      { level: "warn", text: x("Guarda todo al final. Si falla a mitad de camino, no se guarda nada de esa noche y la noche siguiente vuelve a evaluar. Un aviso de un día exacto (como el día 25) podría perderse.",
        "It saves everything at the end. If it fails halfway, nothing from that night is saved and the next night evaluates again. A notice tied to an exact day (like day 25) could be lost.") },
      HUB_LOG_ONLY,
    ],
    notes: [
      x("Entrar al Hub no cuenta como actividad. Cuentan postulaciones, actividades registradas, tareas y sesiones.",
        "Signing in doesn't count as activity. Applications, logged activities, homework and sessions do."),
      x("Los días y puntos se editan en Admin → Reglas y puntos, sin cambiar código.", "Days and points are edited in Admin → Rules & points, without code changes."),
    ],
    source: { repo: "geekforce-career-hub", url: HUB_REPO, files: ["backend/app/jobs.py (daily)", "backend/app/engine.py"] },
    diagram: [
      { t: "start", label: x("Cada noche 01:00 (hora de Miami)", "Every night 01:00 (Miami time)") },
      { t: "step", kind: "write", label: x("Cierra las pausas que terminaron", "Closes pauses that ended") },
      { t: "step", kind: "read", label: x("Para cada estudiante activo…", "For each active student…") },
      { t: "decision", label: x("¿Qué revisa?", "What does it check?"), branches: [
        { label: x("Escalera Not Started", "Not Started ladder"), nodes: [
          { t: "step", kind: "calc", label: x("Días desde la activación sin primera 1:1", "Days since activation without first 1:1") },
          { t: "step", kind: "send", label: x("Día 7 aviso · 15 en espera · 30 garantía perdida", "Day 7 notice · 15 on hold · 30 guarantee lost") }] },
        { label: x("LinkedIn y reclutadores", "LinkedIn & recruiters"), nodes: [
          { t: "step", kind: "calc", label: x("¿14 días sin actividad?", "14 days without activity?") },
          { t: "step", kind: "write", label: x("−10 puntos + aviso", "−10 points + notice") }] },
        { label: x("Inactividad", "Inactivity"), nodes: [
          { t: "step", kind: "send", label: x("Día 25: aviso", "Day 25: warning") },
          { t: "step", kind: "write", label: x("Día 31: −20 · luego −10 por semana", "Day 31: −20 · then −10 weekly") }] },
      ] },
      { t: "step", kind: "calc", label: x("Recalcula el estado: asegurada · en riesgo · suspendida", "Recalculates status: secured · at risk · suspended") },
      { t: "link", to: "ac-sync", label: x("A las 02:00, ActiveCampaign recibe el estado nuevo", "At 02:00, ActiveCampaign gets the new status") },
    ],
  },
  {
    id: "reminders",
    platform: "hub",
    name: x("Recordatorios", "Reminders"),
    short: x("Avisa de tareas que vencen en 48 horas y de pausas que terminan en 3 días.", "Reminds about homework due in 48 hours and pauses ending in 3 days."),
    trigger: { kind: "schedule", schedule: { days: [1, 2, 3, 4, 5, 6, 7], time: "09:00", tz: "America/New_York" } },
    manual: HUB_MANUAL,
    what: x("Cada mañana busca las tareas del coach que vencen en dos días y las pausas que terminan en tres, y le avisa al estudiante. Cada recordatorio se envía una sola vez.",
      "Every morning it finds coach homework due in two days and pauses ending in three, and notifies the student. Each reminder is sent only once."),
    audience: [x("Tareas pendientes con vencimiento en 2 días", "Pending homework due in 2 days"), x("Pausas aprobadas que terminan en 3 días", "Approved pauses ending in 3 days")],
    channels: ["inapp", "email"],
    writes: [x("Notificación al estudiante", "Notification to the student"), x("Marca el recordatorio como enviado", "Marks the reminder as sent")],
    errors: [
      { level: "ok", text: x("Marca cada recordatorio como enviado, así nunca se repite.", "Marks each reminder as sent, so it's never repeated.") },
      { level: "warn", text: x("Busca la fecha exacta («dentro de 2 días»). Si no corre ese día, ese recordatorio no sale.", "It looks for the exact date («in 2 days»). If it doesn't run that day, that reminder doesn't go out.") },
      HUB_LOG_ONLY,
    ],
    notes: [x("El estudiante puede apagar el recordatorio de tareas en sus preferencias.", "Students can turn off homework reminders in their preferences.")],
    source: { repo: "geekforce-career-hub", url: HUB_REPO, files: ["backend/app/jobs.py (reminders)"] },
    diagram: [
      { t: "start", label: x("Cada mañana 09:00 (hora de Miami)", "Every morning 09:00 (Miami time)") },
      { t: "decision", label: x("¿Qué encontró?", "What did it find?"), branches: [
        { label: x("Tarea vence en 48 h", "Homework due in 48 h"), nodes: [{ t: "step", kind: "send", label: x("Aviso «Tarea en 48 horas»", "«Homework due in 48 hours» notice") }] },
        { label: x("Pausa termina en 3 días", "Pause ends in 3 days"), nodes: [{ t: "step", kind: "send", label: x("Aviso «Tu pausa termina en 3 días»", "«Your pause ends in 3 days» notice") }] },
      ] },
      { t: "step", kind: "write", label: x("Marca el recordatorio como enviado", "Marks the reminder as sent") },
    ],
  },
  {
    id: "friday-nudge",
    platform: "hub",
    name: x("Empujón del viernes", "Friday nudge"),
    short: x("El viernes avisa a quien va por debajo de su meta de postulaciones de la semana.", "On Friday it warns students below their weekly application goal."),
    trigger: { kind: "schedule", schedule: { days: [5], time: "17:00", tz: "America/New_York" } },
    manual: HUB_MANUAL,
    what: x("El viernes por la tarde cuenta las postulaciones de la semana. A quien no llega a su meta (15 con Job Guarantee, 10 con Professional Support) le deja un aviso en la app con cuántas le faltan antes del domingo.",
      "On Friday afternoon it counts the week's applications. Anyone under their goal (15 with Job Guarantee, 10 with Professional Support) gets an in-app notice with how many are left before Sunday."),
    audience: [x("Estudiantes activos en Stage 3 (búsqueda), sin pausa", "Active students in Stage 3 (job hunting), not paused")],
    channels: ["inapp"],
    writes: [x("Notificación en la app (no envía email)", "In-app notification (no email)")],
    errors: [HUB_LOG_ONLY],
    notes: [x("No cobra ni premia nada: es solo un aviso. El lunes, el control semanal hace la cuenta.", "It doesn't charge or reward anything: it's only a notice. On Monday the weekly check does the math.")],
    source: { repo: "geekforce-career-hub", url: HUB_REPO, files: ["backend/app/jobs.py (friday_nudge)"] },
    diagram: [
      { t: "start", label: x("Viernes 17:00 (hora de Miami)", "Friday 17:00 (Miami time)") },
      { t: "step", kind: "calc", label: x("Cuenta postulaciones de lunes a hoy", "Counts applications Monday to today") },
      { t: "decision", label: x("¿Llega a la meta?", "Meets the goal?"), branches: [
        { label: x("Sí", "Yes"), nodes: [{ t: "end", label: x("Nada", "Nothing") }] },
        { label: x("No", "No"), nodes: [{ t: "step", kind: "send", label: x("Aviso en la app: «Te faltan N esta semana»", "In-app notice: «N to go this week»") }] },
      ] },
      { t: "link", to: "weekly-check", label: x("El lunes, el control semanal cobra o premia", "On Monday, the weekly check charges or rewards") },
    ],
  },
  {
    id: "weekly-check",
    platform: "hub",
    name: x("Control semanal", "Weekly check"),
    short: x("Los lunes evalúa la semana anterior: +10 si llegó a la meta de postulaciones, −10 si no.", "On Mondays it evaluates last week: +10 if the application goal was met, −10 if not."),
    trigger: { kind: "schedule", schedule: { days: [1], time: "06:00", tz: "America/New_York" } },
    manual: HUB_MANUAL,
    what: x("Cada lunes temprano cuenta las postulaciones de la semana que terminó. Si llegó a la meta suma un bono de +10; si no, descuenta 10 y le avisa al estudiante cuál es la meta de esta semana.",
      "Every Monday morning it counts the applications of the week that ended. If the goal was met it adds a +10 bonus; if not, it deducts 10 and tells the student this week's goal."),
    audience: [
      x("Estudiantes activos en Stage 3 (búsqueda)", "Active students in Stage 3 (job hunting)"),
      x("Se salta la primera semana incompleta y las semanas en pausa", "Skips the first partial week and paused weeks"),
    ],
    rules: [
      { when: x("Llegó a la meta (15 Job Guarantee · 10 Professional Support)", "Met the goal (15 Job Guarantee · 10 Professional Support)"), then: x("+10 puntos de bono", "+10 bonus points") },
      { when: x("No llegó y no estaba en pausa", "Missed it and wasn't paused"), then: x("−10 puntos y aviso", "−10 points and notice") },
    ],
    channels: ["inapp", "email"],
    writes: [x("Puntos del estudiante", "Student points"), x("Notificación del descuento", "Deduction notification")],
    errors: [IDEMPOTENT, HUB_LOG_ONLY],
    source: { repo: "geekforce-career-hub", url: HUB_REPO, files: ["backend/app/jobs.py (weekly_check)"] },
    diagram: [
      { t: "start", label: x("Lunes 06:00 (hora de Miami)", "Monday 06:00 (Miami time)") },
      { t: "step", kind: "calc", label: x("Cuenta postulaciones de la semana anterior", "Counts last week's applications") },
      { t: "decision", label: x("¿Llegó a la meta?", "Met the goal?"), branches: [
        { label: x("Sí", "Yes"), nodes: [{ t: "step", kind: "write", label: x("+10 bono", "+10 bonus") }] },
        { label: x("No", "No"), nodes: [
          { t: "step", kind: "write", label: x("−10 (si no estaba en pausa)", "−10 (if not paused)") },
          { t: "step", kind: "send", label: x("Aviso con la meta de esta semana", "Notice with this week's goal") }] },
      ] },
      { t: "step", kind: "calc", label: x("Recalcula el estado de la garantía", "Recalculates the guarantee status") },
    ],
  },
  {
    id: "job-radar",
    platform: "hub",
    name: x("Job Radar (Adzuna)", "Job Radar (Adzuna)"),
    short: x("Cada mañana busca ofertas junior nuevas en Adzuna para cada programa y las suma al Job Radar.", "Every morning it searches Adzuna for new junior jobs for each program and adds them to the Job Radar."),
    trigger: { kind: "schedule", schedule: { days: [1, 2, 3, 4, 5, 6, 7], time: "10:00", tz: "America/New_York" } },
    manual: HUB_MANUAL,
    what: x("Busca en Adzuna (Estados Unidos) ofertas de las últimas 24 horas con títulos de nivel inicial para Full Stack, AI Engineering, Data Science y Cybersecurity. Descarta las senior y las repetidas. Los coaches luego las revisan en el Job Radar y las comparten con quien encaja.",
      "Searches Adzuna (United States) for jobs from the last 24 hours with entry-level titles for Full Stack, AI Engineering, Data Science and Cybersecurity. It drops senior and duplicate ones. Coaches then review them in the Job Radar and share them with students who fit."),
    audience: [x("Solo corre si el Hub tiene ADZUNA_APP_ID y ADZUNA_APP_KEY", "Only runs if the Hub has ADZUNA_APP_ID and ADZUNA_APP_KEY")],
    channels: ["none"],
    writes: [x("Ofertas nuevas en el Job Radar", "New jobs in the Job Radar")],
    errors: [
      { level: "ok", text: x("Si falla una búsqueda, sigue con las demás y guarda lo que encontró.", "If one search fails, it continues with the rest and keeps what it found.") },
      { level: "ok", text: x("No duplica: si la misma oferta llega de otra fuente, la une.", "No duplicates: if the same job comes from another source, it merges it.") },
      HUB_LOG_ONLY,
    ],
    source: { repo: "geekforce-career-hub", url: HUB_REPO, files: ["backend/app/job_radar.py"] },
    diagram: [
      { t: "start", label: x("Cada mañana 10:00 (hora de Miami)", "Every morning 10:00 (Miami time)") },
      { t: "step", kind: "read", label: x("Busca en Adzuna los títulos junior de cada programa (últimas 24 h)", "Searches Adzuna for each program's junior titles (last 24 h)") },
      { t: "decision", label: x("¿Es senior?", "Is it senior?"), branches: [
        { label: x("Sí", "Yes"), nodes: [{ t: "end", label: x("Se descarta", "Dropped") }] },
        { label: x("No", "No"), nodes: [{ t: "step", kind: "write", label: x("Guarda o une con la oferta existente", "Saves or merges with the existing job") }] },
      ] },
      { t: "end", label: x("Los coaches la ven en Job Radar y la comparten", "Coaches see it in Job Radar and share it") },
    ],
  },
  {
    id: "jobs-ingest",
    platform: "hub",
    name: x("Ingreso de ofertas (grokbot)", "Job intake (grokbot)"),
    short: x("Recibe ofertas que envía grokbot u otra herramienta y las suma al Job Radar.", "Receives jobs sent by grokbot or another tool and adds them to the Job Radar."),
    trigger: { kind: "event", label: x("Cuando grokbot (u otra herramienta) envía ofertas al Hub", "When grokbot (or another tool) sends jobs to the Hub") },
    what: x("Es una puerta de entrada: herramientas externas como grokbot mandan ofertas (hasta 500 por envío) con una clave secreta. El Hub las guarda en el Job Radar sin duplicarlas.",
      "It's an entry door: external tools like grokbot send jobs (up to 500 per call) with a secret key. The Hub saves them in the Job Radar without duplicates."),
    audience: [x("Envíos con la clave X-Jobs-Secret correcta", "Calls with the right X-Jobs-Secret key")],
    channels: ["none"],
    writes: [x("Ofertas nuevas o actualizadas en el Job Radar", "New or updated jobs in the Job Radar")],
    errors: [
      { level: "ok", text: x("Sin la clave correcta, el envío se rechaza.", "Without the right key, the call is rejected.") },
      { level: "ok", text: x("Si una oferta viene mal, se informa al que envía y el resto se guarda.", "If one job is malformed, the sender is told and the rest are saved.") },
    ],
    source: { repo: "geekforce-career-hub", url: HUB_REPO, files: ["backend/app/routers/jobs_routes.py (POST /api/v1/integrations/jobs)"] },
    diagram: [
      { t: "start", label: x("grokbot envía ofertas", "grokbot sends jobs") },
      { t: "decision", label: x("¿Clave correcta?", "Right key?"), branches: [
        { label: x("No", "No"), nodes: [{ t: "error", label: x("Rechazado", "Rejected") }] },
        { label: x("Sí", "Yes"), nodes: [{ t: "step", kind: "write", label: x("Guarda o une cada oferta", "Saves or merges each job") }] },
      ] },
      { t: "link", to: "job-radar", label: x("Aparecen en el mismo Job Radar", "They show up in the same Job Radar") },
    ],
  },
  {
    id: "ac-sync",
    platform: "hub",
    name: x("Sincronización con ActiveCampaign", "ActiveCampaign sync"),
    short: x("Cada noche deja al día en ActiveCampaign los datos, la etapa y el estado de cada estudiante. No envía emails.",
      "Every night it updates each student's data, stage and status in ActiveCampaign. It sends no emails."),
    trigger: { kind: "schedule", schedule: { days: [1, 2, 3, 4, 5, 6, 7], time: "02:00", tz: "America/New_York" } },
    manual: HUB_MANUAL,
    what: x("ActiveCampaign es el canal de email. Para que sus automatizaciones funcionen, cada contacto tiene campos y etiquetas del Hub (etapa, estado de la garantía, puntos, coach). Esta tarea los corrige cada noche por si algún cambio no llegó en el momento.",
      "ActiveCampaign is the email channel. For its automations to work, each contact has Hub fields and tags (stage, guarantee status, points, coach). This task fixes them every night in case a change didn't arrive at the moment."),
    audience: [x("Estudiantes activos o contratados", "Active or hired students"), x("Solo corre si ActiveCampaign está conectado", "Only runs if ActiveCampaign is connected")],
    channels: ["activecampaign"],
    writes: [x("Campos y etiquetas del contacto en ActiveCampaign", "Contact fields and tags in ActiveCampaign")],
    errors: [
      { level: "ok", text: x("Si falla con un estudiante, lo cuenta como fallido y sigue.", "If it fails for one student, it counts it as failed and moves on.") },
      HUB_LOG_ONLY,
    ],
    source: { repo: "geekforce-career-hub", url: HUB_REPO, files: ["backend/app/jobs.py (ac_sync)", "backend/app/services/activecampaign.py"] },
    diagram: [
      { t: "start", label: x("Cada noche 02:00 (hora de Miami)", "Every night 02:00 (Miami time)") },
      { t: "step", kind: "read", label: x("Toma a los estudiantes activos y contratados", "Takes active and hired students") },
      { t: "step", kind: "send", label: x("Actualiza campos y etiquetas en ActiveCampaign", "Updates fields and tags in ActiveCampaign") },
      { t: "end", label: x("Las automatizaciones de ActiveCampaign usan esos datos", "ActiveCampaign automations use that data") },
    ],
  },
  {
    id: "state-events",
    platform: "hub",
    name: x("Avisos de cambio de etapa y estado", "Stage and status change events"),
    short: x("Cuando un estudiante cambia de etapa o de estado, el Hub lo avisa al momento a ActiveCampaign y a n8n.",
      "When a student changes stage or status, the Hub tells ActiveCampaign and n8n right away."),
    trigger: { kind: "event", label: x("Un estudiante cambia de etapa (por el coach o por Notion) o un coach cambia su estado", "A student changes stage (by the coach or from Notion) or a coach changes their status") },
    what: x("Cada cambio importante se envía en segundo plano, justo después de guardarse: a ActiveCampaign (etiquetas de etapa y estado) y, si está configurado, a un webhook de n8n para lo que el equipo quiera (alertas en Slack, volver a escribir en Notion, etc.).",
      "Every important change is sent in the background right after it's saved: to ActiveCampaign (stage and status tags) and, if set up, to an n8n webhook for whatever the team wants (Slack alerts, writing back to Notion, etc.)."),
    audience: [x("Cualquier estudiante que cambie de etapa o de estado", "Any student whose stage or status changes")],
    channels: ["activecampaign", "webhook"],
    writes: [x("Etiquetas en ActiveCampaign", "Tags in ActiveCampaign"), x("Un aviso al webhook de n8n (AUTOMATION_WEBHOOK_URL)", "A call to the n8n webhook (AUTOMATION_WEBHOOK_URL)")],
    errors: [
      { level: "ok", text: x("Un fallo nunca frena al coach: el cambio se guarda igual.", "A failure never blocks the coach: the change is saved anyway.") },
      { level: "risk", text: x("Si n8n no responde, el aviso se pierde: no se reintenta. Solo queda en los logs del servidor.", "If n8n doesn't answer, the event is lost: it isn't retried. It's only in the server logs.") },
      { level: "ok", text: x("Lo que no llegue a ActiveCampaign se corrige en la sincronización de las 02:00.", "Whatever doesn't reach ActiveCampaign is fixed by the 02:00 sync.") },
    ],
    source: { repo: "geekforce-career-hub", url: HUB_REPO, files: ["backend/app/events.py", "backend/app/stages.py"] },
    diagram: [
      { t: "start", label: x("Cambio de etapa o de estado", "Stage or status change") },
      { t: "step", kind: "write", label: x("Se guarda el cambio", "The change is saved") },
      { t: "decision", label: x("En segundo plano, envía a…", "In the background, sends to…"), branches: [
        { label: x("ActiveCampaign", "ActiveCampaign"), nodes: [{ t: "step", kind: "send", label: x("Etiquetas de etapa y estado", "Stage and status tags") }] },
        { label: x("n8n", "n8n"), nodes: [
          { t: "step", kind: "send", label: x("Webhook con los datos del estudiante", "Webhook with the student's data") },
          { t: "error", label: x("Si falla: se pierde (sin reintento)", "If it fails: lost (no retry)") }] },
      ] },
      { t: "link", to: "ac-sync", label: x("De noche, ac_sync corrige lo que no llegó", "At night, ac_sync fixes what didn't arrive") },
    ],
  },
];

/** How automations relate. Shown in both cards (outgoing and incoming) and in the overview. */
export const EDGES: Edge[] = [
  { from: "not-started", to: "missing", kind: "runs_before", label: x("Corre justo antes, el mismo viernes, y le pasa a quienes cambia a Missing", "Runs right before, same Friday, and hands over the students it moves to Missing") },
  { from: "stage1-2", to: "missing", kind: "feeds", label: x("Quienes pasan a Missing entran a su escalada de emails", "Students moved to Missing enter its email ladder") },
  { from: "on-hold", to: "stage1-2", kind: "data", label: x("Borra las etiquetas GF Follow up que este flujo usa para saber qué mensajes envió", "Erases the GF Follow up tags this flow uses to know which messages it sent") },
  { from: "on-hold", to: "missing", kind: "data", label: x("Borra las etiquetas GF Follow up que este flujo usa para saber qué emails envió", "Erases the GF Follow up tags this flow uses to know which emails it sent") },
  { from: "notion-sync", to: "daily", kind: "feeds", label: x("Trae a los estudiantes y su etapa; los controles diarios los evalúan", "Brings the students and their stage; the daily checks evaluate them") },
  { from: "notion-sync", to: "state-events", kind: "feeds", label: x("Un cambio de etapa en Notion dispara el aviso de cambio", "A stage change in Notion fires the change event") },
  { from: "daily", to: "ac-sync", kind: "feeds", label: x("A las 02:00 lleva a ActiveCampaign el estado que se recalculó a la 01:00", "At 02:00 it takes to ActiveCampaign the status recalculated at 01:00") },
  { from: "friday-nudge", to: "weekly-check", kind: "runs_before", label: x("Aviso el viernes; el lunes se cobra o se premia", "Notice on Friday; on Monday it charges or rewards") },
  { from: "jobs-ingest", to: "job-radar", kind: "data", label: x("Ambas llenan el mismo Job Radar", "Both fill the same Job Radar") },
  { from: "state-events", to: "ac-sync", kind: "data", label: x("Lo que un aviso no logre enviar, se corrige de noche", "Whatever an event fails to send is fixed at night") },
  { from: "not-started", to: "daily", kind: "similar", label: x("Misma idea para Miami: la escalera Not Started (días 7, 15 y 30)", "Same idea for Miami: the Not Started ladder (days 7, 15 and 30)") },
];

/** Groups shown in the overview "how they connect". */
export const CHAINS: { title: Tx; ids: string[] }[] = [
  { title: x("Seguimiento España (viernes)", "Spain follow-up (Friday)"), ids: ["not-started", "missing"] },
  { title: x("Etapas que terminan en Missing", "Stages that end in Missing"), ids: ["stage1-2", "missing"] },
  { title: x("Noche del Career Hub", "Career Hub night"), ids: ["notion-sync", "daily", "ac-sync"] },
  { title: x("Semana de postulaciones", "Application week"), ids: ["friday-nudge", "weekly-check"] },
  { title: x("Ofertas", "Jobs"), ids: ["jobs-ingest", "job-radar"] },
];

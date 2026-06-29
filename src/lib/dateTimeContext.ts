export const CLINIC_TIME_ZONE = "America/Denver";

export type WendyTimeOfDay =
  | "morning"
  | "afternoon"
  | "evening"
  | "after-hours";

export type WendyDateTimeContext = {
  timeZone: typeof CLINIC_TIME_ZONE;
  date: string;
  dayOfWeek: string;
  localTime: string;
  hour: number;
  minute: number;
  timeOfDay: WendyTimeOfDay;
};

function getTimeOfDay(hour: number): WendyTimeOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "after-hours";
}

export function getWendyDateTimeContext(now = new Date()): WendyDateTimeContext {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CLINIC_TIME_ZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(getPart("hour")) % 24;
  const minute = Number(getPart("minute"));

  return {
    timeZone: CLINIC_TIME_ZONE,
    date: `${getPart("month")} ${getPart("day")}, ${getPart("year")}`,
    dayOfWeek: getPart("weekday"),
    localTime: new Intl.DateTimeFormat("en-US", {
      timeZone: CLINIC_TIME_ZONE,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(now),
    hour,
    minute,
    timeOfDay: getTimeOfDay(hour),
  };
}

export function formatWendyDateTimePrompt(context: WendyDateTimeContext) {
  return [
    "Server-generated clinic date/time context (authoritative for relative dates and current-time questions):",
    `Clinic timezone: ${context.timeZone}`,
    `Current date: ${context.date}`,
    `Current day of week: ${context.dayOfWeek}`,
    `Current local time: ${context.localTime}`,
    `Time of day: ${context.timeOfDay}`,
    "Use this context for today, right now, weekday, hours, booking, and provider-location questions. Distinguish general clinic hours from a provider's recurring schedule and from live appointment openings. Never claim that a live appointment is available; direct users to JaneApp or the clinic for real-time confirmation.",
  ].join("\n");
}

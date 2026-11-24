const CHINA_OFFSET = "+08:00";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function parseChinaDateTime(
  value: string | null | undefined,
  defaultTime = "00:00:00",
): string | null {
  if (!value) return null;
  const normalized = value
    .replace(/[年月/.]/g, "-")
    .replace(/日/g, " ")
    .replace(/[时点]/g, ":")
    .replace(/分/g, ":")
    .replace(/秒/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const match = normalized.match(
    /(20\d{2})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?/,
  );
  if (!match) return null;

  const [, year, month, day, rawHour, rawMinute, rawSecond] = match;
  const [defaultHour = "00", defaultMinute = "00", defaultSecond = "00"] = defaultTime.split(":");
  const hour = rawHour ?? defaultHour;
  const minute = rawHour === undefined ? defaultMinute : (rawMinute ?? "00");
  const second = rawHour === undefined ? defaultSecond : (rawSecond ?? "00");
  if (Number(hour) === 24 && Number(minute) === 0 && Number(second) === 0) {
    const nextDay = new Date(`${year}-${pad(Number(month))}-${pad(Number(day))}T00:00:00${CHINA_OFFSET}`);
    nextDay.setTime(nextDay.getTime() + 24 * 60 * 60 * 1000);
    return chinaIso(nextDay);
  }
  const iso = `${year}-${pad(Number(month))}-${pad(Number(day))}T${pad(Number(hour))}:${pad(Number(minute))}:${pad(Number(second))}${CHINA_OFFSET}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function chinaDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function chinaIso(value: Date): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";
  const rawHour = get("hour");
  const hour = rawHour === "24" ? "00" : rawHour;
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}${CHINA_OFFSET}`;
}

export function chinaDateTimeDisplay(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replaceAll("/", "-");
}

export function deadlineStatus(
  deadline: string | null,
  asOf: string,
  applicable = true,
): string {
  if (!applicable) return "不适用";
  if (!deadline) return "未知";
  return Date.parse(deadline) >= Date.parse(asOf) ? "未截止" : "已截止";
}

export function subtractDays(value: Date, days: number): Date {
  return new Date(value.getTime() - days * 24 * 60 * 60 * 1000);
}

export function asChinaEndOfDay(dateText: string): string {
  return `${dateText}T23:59:59${CHINA_OFFSET}`;
}

export function asChinaStartOfDay(dateText: string): string {
  return `${dateText}T00:00:00${CHINA_OFFSET}`;
}

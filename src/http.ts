export interface FetchTextResult {
  url: string;
  status: number;
  text: string;
  contentType: string;
}

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5",
};

function decoderFor(contentType: string): TextDecoder {
  const charset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]?.toLowerCase();
  if (charset?.includes("gb")) return new TextDecoder("gb18030");
  return new TextDecoder("utf-8");
}

export async function fetchText(
  url: string,
  options: { timeoutMs?: number; retries?: number; referer?: string } = {},
): Promise<FetchTextResult> {
  const timeoutMs = options.timeoutMs ?? 25_000;
  const retries = options.retries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          ...DEFAULT_HEADERS,
          ...(options.referer ? { Referer: options.referer } : {}),
        },
      });
      const contentType = response.headers.get("content-type") ?? "";
      const buffer = await response.arrayBuffer();
      const text = decoderFor(contentType).decode(buffer);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return { url: response.url, status: response.status, text, contentType };
    } catch (error) {
      lastError = error;
      if (attempt < retries) await delay(800 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function postFormJson<T>(
  url: string,
  form: Record<string, string>,
  options: { timeoutMs?: number; retries?: number; referer?: string; headers?: Record<string, string> } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 25_000;
  const retries = options.retries ?? 2;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          ...DEFAULT_HEADERS,
          "Content-Type": "application/x-www-form-urlencoded",
          ...(options.referer ? { Referer: options.referer } : {}),
          ...options.headers,
        },
        body: new URLSearchParams(form),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return JSON.parse(text) as T;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await delay(800 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function postJson<T>(
  url: string,
  body: unknown,
  options: { timeoutMs?: number; retries?: number; referer?: string; headers?: Record<string, string> } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 25_000;
  const retries = options.retries ?? 2;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          ...DEFAULT_HEADERS,
          "Content-Type": "application/json",
          ...(options.referer ? { Referer: options.referer } : {}),
          ...options.headers,
        },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return JSON.parse(text) as T;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await delay(800 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

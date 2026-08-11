// Supabase returns plain `{ message, details, hint, code }` objects rather than
// Error instances, so `String(e)` on them yields a useless "[object Object]".
// Undici also buries the real cause (ENOTFOUND, ECONNREFUSED) under a bare
// "fetch failed" — unwrap it so failures name themselves.
export function describeError(e: unknown): string {
  if (e && typeof e === "object") {
    const cause = (e as { cause?: unknown }).cause;
    const causeMsg =
      cause && typeof cause === "object"
        ? [
            (cause as { code?: string }).code,
            (cause as { message?: string }).message,
          ]
            .filter(Boolean)
            .join(" ")
        : "";

    const parts = e instanceof Error
      ? [e.message]
      : [
          (e as { message?: string }).message,
          (e as { code?: string }).code && `(code ${(e as { code?: string }).code})`,
          (e as { details?: string }).details,
          (e as { hint?: string }).hint,
        ];

    // `details` usually repeats `message` and appends a stack trace. Split every
    // field into lines, drop stack frames, and dedupe across fields — otherwise
    // the same "fetch failed" prints three times.
    const lines = [
      ...new Set(
        parts
          .filter((p): p is string => Boolean(p))
          .flatMap(p => p.split("\n"))
          .map(l => l.trim())
          .filter(l => l && !l.startsWith("at "))
      ),
    ];

    const base = lines.slice(0, 2).join(" — ") || JSON.stringify(e);

    // Don't append a cause the message already spells out.
    return causeMsg && !base.includes(causeMsg) ? `${base} — cause: ${causeMsg}` : base;
  }
  return String(e);
}

// A dead/deleted Supabase project fails as an opaque "TypeError: fetch failed"
// at every call site. Name the host so the next person sees the real problem
// instead of debugging their own code.
export function describeDbError(e: unknown, url: string): string {
  const msg = describeError(e);
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(msg)) {
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return url;
      }
    })();
    return (
      `${msg}\n` +
      `    → could not reach Supabase host "${host}".\n` +
      `      If DNS says NXDOMAIN, the project no longer exists (deleted, or paused\n` +
      `      long enough to be reclaimed). Check the Supabase dashboard, then update\n` +
      `      SUPABASE_URL / SUPABASE_SERVICE_KEY in .env.local.`
    );
  }
  return msg;
}

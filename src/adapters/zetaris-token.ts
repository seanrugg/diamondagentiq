export const TOKEN_REFRESH_SKEW_MS = 60_000;

export function decodeJwtExp(token: string): number | undefined {
  const payloadPart = token.split(".")[1];
  if (!payloadPart) {
    return undefined;
  }

  try {
    const padded = payloadPart.replaceAll("-", "+").replaceAll("_", "/");
    const pad =
      padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const payload = JSON.parse(
      Buffer.from(`${padded}${pad}`, "base64").toString("utf8"),
    ) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}

export function tokenNeedsRefresh(
  token: string,
  nowMs: number = Date.now(),
  skewMs: number = TOKEN_REFRESH_SKEW_MS,
): boolean {
  const exp = decodeJwtExp(token);
  if (exp === undefined) {
    return true;
  }
  return nowMs >= exp * 1000 - skewMs;
}

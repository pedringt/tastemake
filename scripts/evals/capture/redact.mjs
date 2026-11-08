// #341 step 4 capture: keep credentials out of recordings. A recording may hold provider responses and
// catalog rows, never a token, key, secret or database URL. Shared by the recorder (before saving), the
// capture route (before responding) and the tests.

// Query parameters that carry credentials (Twitch's client_secret for IGDB, Google Books' key).
const SECRET_PARAMS = ["client_secret", "client_id", "key", "api_key", "access_token", "token"];

export function redactUrl(raw) {
  const url = new URL(String(raw));
  for (const name of SECRET_PARAMS) if (url.searchParams.has(name)) url.searchParams.set(name, "REDACTED");
  return url.toString();
}

// The Twitch token endpoint answers with an access token. Its shape is kept (replay needs a token to
// proceed); its value isn't.
export function redactBody(url, body) {
  if (new URL(String(url)).hostname !== "id.twitch.tv") return body;
  try {
    const json = JSON.parse(body);
    if (json && typeof json === "object" && "access_token" in json) json.access_token = "REDACTED";
    return JSON.stringify(json);
  } catch {
    return "REDACTED";
  }
}

// Environment values that must never appear in a recording: anything that looks like a credential by
// name, and is long enough not to match by accident.
const SECRET_NAME = /TOKEN|SECRET|KEY|PASSWORD|DATABASE_URL|CLIENT_ID/i;
const SECRET_PATTERNS = [/sk-ant-[A-Za-z0-9_-]{6,}/, /\bBearer\s+[A-Za-z0-9._-]{8,}/, /client_secret=(?!REDACTED)[^&\s"]+/, /postgres(?:ql)?:\/\/[^\s"]+/];

export function findSecrets(text, env = {}) {
  const hits = [];
  for (const [name, value] of Object.entries(env)) {
    if (SECRET_NAME.test(name) && typeof value === "string" && value.length >= 8 && text.includes(value)) hits.push(`env:${name}`);
  }
  for (const pattern of SECRET_PATTERNS) if (pattern.test(text)) hits.push(`pattern:${pattern.source.slice(0, 24)}`);
  return hits;
}

type Env = {
  FIREBASE_SERVICE_ACCOUNT: string;
  RESEND_API_KEY: string;
  RESEND_FROM_EMAIL: string;
};

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
};

const encoder = new TextEncoder();
const b64url = (value: string | Uint8Array) => {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};
const decodeJson = (part: string) => JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, any>;
const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export function jsonResponse(body: Record<string, unknown>, status = 200) {
  return response(body, status);
}

function accountFrom(env: Env): ServiceAccount {
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error("FIREBASE_SERVICE_ACCOUNT manquant.");
  const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as ServiceAccount;
  if (!account.project_id || !account.client_email || !account.private_key) {
    throw new Error("Le compte de service Firebase est incomplet.");
  }
  return account;
}

async function serviceAccessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: account.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = header + "." + claims;
  const pem = account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = Uint8Array.from(atob(pem), char => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", binary, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned)));
  const assertion = unsigned + "." + b64url(signature);
  const tokenResponse = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const tokenData = await tokenResponse.json() as { access_token?: string; error_description?: string };
  if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error_description || "Authentification Firebase Admin impossible.");
  return tokenData.access_token;
}

async function firestoreRequest(account: ServiceAccount, token: string, path: string, init?: RequestInit) {
  const url = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(account.project_id) + "/databases/(default)/documents" + path;
  const result = await fetch(url, { ...init, headers: { authorization: "Bearer " + token, ...(init?.headers || {}) } });
  if (!result.ok) throw new Error("Firestore REST: " + result.status + " " + (await result.text()).slice(0, 400));
  return result.status === 204 ? null : result.json() as Promise<any>;
}

function fieldValue(field: any): any {
  if (!field) return undefined;
  if ("stringValue" in field) return field.stringValue;
  if ("booleanValue" in field) return field.booleanValue;
  if ("integerValue" in field) return Number(field.integerValue);
  if ("timestampValue" in field) return field.timestampValue;
  if ("mapValue" in field) return Object.fromEntries(Object.entries(field.mapValue.fields || {}).map(([key, value]) => [key, fieldValue(value)]));
  if ("arrayValue" in field) return (field.arrayValue.values || []).map(fieldValue);
  return undefined;
}
function documentData(document: any): Record<string, any> {
  return Object.fromEntries(Object.entries(document?.fields || {}).map(([key, value]) => [key, fieldValue(value)]));
}
function firestoreString(value: string) { return { stringValue: value }; }
function firestoreTimestamp(value: string) { return { timestampValue: value }; }

export async function readDocument(account: ServiceAccount, token: string, collection: string, id: string) {
  try {
    const doc = await firestoreRequest(account, token, "/" + collection + "/" + encodeURIComponent(id));
    return { name: doc.name as string, data: documentData(doc) };
  } catch (error) {
    if (error instanceof Error && error.message.includes("Firestore REST: 404")) return null;
    throw error;
  }
}

export async function listActiveSuperAdmins(account: ServiceAccount, token: string) {
  const result = await firestoreRequest(account, token, "/admins?pageSize=100");
  return (result.documents || []).map((doc: any) => ({ id: String(doc.name).split("/").pop(), ...documentData(doc) }))
    .filter((admin: any) => admin.active === true && admin.role === "superAdmin" && typeof admin.email === "string" && admin.email.includes("@"));
}

export async function updateFields(account: ServiceAccount, token: string, documentPath: string, fields: Record<string, any>) {
  const params = Object.keys(fields).map(key => "updateMask.fieldPaths=" + encodeURIComponent(key)).join("&");
  const encodedFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === "string" ? firestoreString(value) : firestoreTimestamp(value)]));
  return firestoreRequest(account, token, "/" + documentPath + "?" + params, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields: encodedFields }),
  });
}

export async function sendEmail(env: Env, to: string, subject: string, html: string, idempotencyKey: string) {
  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: "Bearer " + env.RESEND_API_KEY,
      "content-type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL || "onboarding@resend.dev", to: [to], subject, html }),
  });
  const data = await result.json() as { id?: string; message?: string; name?: string };
  if (!result.ok) throw new Error("Resend: " + (data.message || data.name || result.status));
  return data.id || "sent";
}

export async function authenticateFirebaseUser(request: Request, projectId: string): Promise<string> {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Authentification requise.");
  const token = match[1];
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Jeton Firebase invalide.");
  const header = decodeJson(parts[0]);
  const claims = decodeJson(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Signature du jeton invalide.");
  const jwksResponse = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  if (!jwksResponse.ok) throw new Error("Impossible de vérifier le jeton Firebase.");
  const jwks = await jwksResponse.json() as { keys: JsonWebKey[] };
  const jwk = jwks.keys.find((item: any) => item.kid === header.kid);
  if (!jwk) throw new Error("Clé de signature Firebase inconnue.");
  const publicKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signature = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, encoder.encode(parts[0] + "." + parts[1]));
  const now = Math.floor(Date.now() / 1000);
  if (!valid || claims.aud !== projectId || claims.iss !== "https://securetoken.google.com/" + projectId
    || !claims.sub || claims.exp <= now || claims.iat > now + 60) throw new Error("Jeton Firebase expiré ou invalide.");
  return claims.sub as string;
}

export function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
}

export async function createContext(env: Env) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY manquant.");
  const account = accountFrom(env);
  const token = await serviceAccessToken(account);
  return { account, token };
}

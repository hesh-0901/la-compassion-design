type Env = {
  FIREBASE_SERVICE_ACCOUNT: string;
  MAILER_WEB_APP_URL: string;
  MAILER_SECRET: string;
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

export async function serviceAccessToken(account: ServiceAccount, scope = "https://www.googleapis.com/auth/datastore"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: account.client_email,
    scope,
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
  return result.status === 204 || init?.method === "DELETE" ? null : result.json() as Promise<any>;
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
function firestoreValue(value: unknown): Record<string, unknown> {
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isFinite(value)) return { doubleValue: value };
  if (typeof value === "string") return firestoreString(value);
  if (value === null) return { nullValue: null };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, firestoreValue(item)])) } };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  throw new Error("Type Firestore non pris en charge.");
}

export async function readDocument(account: ServiceAccount, token: string, collection: string, id: string) {
  try {
    const doc = await firestoreRequest(account, token, "/" + collection + "/" + encodeURIComponent(id));
    return { name: doc.name as string, updateTime: doc.updateTime as string | undefined, data: documentData(doc) };
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
  const encodedFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === "string" && /At$/.test(key) && !Number.isNaN(Date.parse(value)) ? firestoreTimestamp(value) : firestoreValue(value)]));
  return firestoreRequest(account, token, "/" + documentPath + "?" + params, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields: encodedFields }),
  });
}

/**
 * Conditional PATCH: succeeds only if the document has not changed since it was read.
 * Used to claim a failed WhatsApp notification without allowing two concurrent retries.
 */
export async function updateFieldsIfUnchanged(
  account: ServiceAccount,
  token: string,
  documentPath: string,
  fields: Record<string, any>,
  updateTime: string,
): Promise<boolean> {
  const params = [
    ...Object.keys(fields).map(key => "updateMask.fieldPaths=" + encodeURIComponent(key)),
    "currentDocument.updateTime=" + encodeURIComponent(updateTime),
  ].join("&");
  const encodedFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [
    key,
    typeof value === "string" && /At$/.test(key) && !Number.isNaN(Date.parse(value))
      ? firestoreTimestamp(value)
      : firestoreValue(value),
  ]));
  try {
    await firestoreRequest(account, token, "/" + documentPath + "?" + params, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields: encodedFields }),
    });
    return true;
  } catch (error) {
    if (error instanceof Error && /Firestore REST: (409|412)/.test(error.message)) return false;
    throw error;
  }
}

export async function createDocument(account: ServiceAccount, token: string, collection: string, id: string, fields: Record<string, unknown>) {
  const encodedFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, firestoreValue(value)]));
  return firestoreRequest(account, token, "/" + collection + "?documentId=" + encodeURIComponent(id), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields: encodedFields }),
  });
}

export async function sendEmail(env: Env, to: string, subject: string, html: string, idempotencyKey: string) {
  if (!env.MAILER_WEB_APP_URL || !env.MAILER_SECRET) {
    throw new Error("MAILER_WEB_APP_URL ou MAILER_SECRET manquant dans Cloudflare.");
  }
  const result = await fetch(env.MAILER_WEB_APP_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: env.MAILER_SECRET, to, subject, html, idempotencyKey }),
    redirect: "follow",
  });
  const raw = await result.text();
  let data: { success?: boolean; error?: string };
  try { data = JSON.parse(raw) as { success?: boolean; error?: string }; }
  catch { throw new Error("Réponse Apps Script invalide : " + raw.slice(0, 250)); }
  if (!result.ok || !data.success) throw new Error(data.error || "Échec de l'envoi Gmail.");
  return idempotencyKey;
}


export async function createAdminProfile(account: ServiceAccount, token: string, uid: string, profile: { firstName: string; lastName: string; email: string }) {
  const url = "/admins?documentId=" + encodeURIComponent(uid);
  return firestoreRequest(account, token, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields: {
      firstName: { stringValue: profile.firstName },
      lastName: { stringValue: profile.lastName },
      email: { stringValue: profile.email },
      role: { stringValue: "admin" },
      active: { booleanValue: true },
      createdAt: { timestampValue: new Date().toISOString() },
    } }),
  });
}

export async function createFirebaseAuthUser(projectId: string, apiKey: string, accessToken: string, user: { email: string; password: string; displayName: string }) {
  const url = "https://identitytoolkit.googleapis.com/v1/projects/" + encodeURIComponent(projectId) + "/accounts?key=" + encodeURIComponent(apiKey);
  const result = await fetch(url, {
    method: "POST",
    headers: { authorization: "Bearer " + accessToken, "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password, displayName: user.displayName, emailVerified: false, disabled: false, returnSecureToken: false }),
  });
  const data = await result.json() as { localId?: string; error?: { message?: string } };
  if (!result.ok || !data.localId) {
    const code = data.error?.message || "AUTH_CREATE_FAILED";
    const messages: Record<string, string> = {
      EMAIL_EXISTS: "Cette adresse e-mail est déjà utilisée.",
      INVALID_EMAIL: "L’adresse e-mail générée est invalide.",
      WEAK_PASSWORD: "Le mot de passe ne respecte pas les exigences de sécurité Firebase.",
      OPERATION_NOT_ALLOWED: "La connexion par e-mail et mot de passe n’est pas activée dans Firebase Authentication.",
      PERMISSION_DENIED: "Le compte de service n’a pas l’autorisation de créer des utilisateurs Firebase.",
    };
    throw new Error(messages[code] || "Firebase Authentication : " + code);
  }
  return data.localId;
}

export async function deleteFirebaseAuthUser(projectId: string, apiKey: string, accessToken: string, uid: string) {
  const url = "https://identitytoolkit.googleapis.com/v1/projects/" + encodeURIComponent(projectId) + "/accounts:delete?key=" + encodeURIComponent(apiKey);
  const result = await fetch(url, {
    method: "POST",
    headers: { authorization: "Bearer " + accessToken, "content-type": "application/json" },
    body: JSON.stringify({ localId: uid }),
  });
  if (!result.ok) throw new Error("Impossible d’annuler la création du compte Firebase : " + result.status);
}


export async function deleteAdminProfile(account: ServiceAccount, token: string, uid: string) {
  return firestoreRequest(account, token, "/admins/" + encodeURIComponent(uid), { method: "DELETE" });
}

export async function updateFirebaseAuthPassword(projectId: string, apiKey: string, accessToken: string, uid: string, password: string) {
  const url = "https://identitytoolkit.googleapis.com/v1/projects/" + encodeURIComponent(projectId) + "/accounts:update?key=" + encodeURIComponent(apiKey);
  const result = await fetch(url, {
    method: "POST",
    headers: { authorization: "Bearer " + accessToken, "content-type": "application/json" },
    body: JSON.stringify({ localId: uid, password, returnSecureToken: false }),
  });
  const data = await result.json() as { localId?: string; error?: { message?: string } };
  if (!result.ok || !data.localId) {
    const code = data.error?.message || "AUTH_PASSWORD_UPDATE_FAILED";
    const messages: Record<string, string> = {
      USER_NOT_FOUND: "Compte Firebase introuvable.",
      WEAK_PASSWORD: "Le mot de passe doit contenir au moins 8 caractères et respecter les exigences Firebase.",
      OPERATION_NOT_ALLOWED: "La gestion des mots de passe n’est pas autorisée dans Firebase Authentication.",
      PERMISSION_DENIED: "Le compte de service n’a pas l’autorisation de modifier les comptes Firebase.",
    };
    throw new Error(messages[code] || "Firebase Authentication : " + code);
  }
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

export async function createAdminServiceContext(env: { FIREBASE_SERVICE_ACCOUNT: string }) {
  const account = accountFrom(env);
  const token = await serviceAccessToken(account, "https://www.googleapis.com/auth/cloud-platform");
  return { account, token };
}

export async function createContext(env: Env) {
  // Firestore-only endpoints must not depend on the optional email delivery configuration.
  // sendEmail() validates MAILER_WEB_APP_URL and MAILER_SECRET at the point where email is sent.
  const account = accountFrom(env);
  const token = await serviceAccessToken(account);
  return { account, token };
}

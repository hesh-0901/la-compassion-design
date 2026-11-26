type Env = {
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  FIREBASE_SERVICE_ACCOUNT?: string;
};

import { createContext, readDocument, updateFields } from "../../_shared/notifications";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

function bytesFromHex(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function hasValidSignature(rawBody: string, signatureHeader: string | null, appSecret: string): Promise<boolean> {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const received = bytesFromHex(signatureHeader.slice(7));
  if (!received) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
  );

  let difference = 0;
  for (let i = 0; i < expected.length; i += 1) difference |= expected[i] ^ received[i];
  return difference === 0;
}

/**
 * Meta calls GET once when the webhook URL is registered.
 * The challenge must be returned as plain text when the verify token matches.
 */
export const onRequestGet = async ({
  request,
  env,
}: {
  request: Request;
  env: Env;
}) => {
  if (!env.WHATSAPP_VERIFY_TOKEN) {
    return new Response("Webhook non configuré.", { status: 503 });
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return new Response("Vérification du webhook refusée.", { status: 403 });
};

/**
 * Meta sends webhook events as POST requests.
 * Validate X-Hub-Signature-256 before accepting the payload.
 */
export const onRequestPost = async ({
  request,
  env,
}: {
  request: Request;
  env: Env;
}) => {
  if (!env.WHATSAPP_APP_SECRET) {
    return json({ error: "Webhook non configuré." }, 503);
  }

  const rawBody = await request.text();
  try {
    const valid = await hasValidSignature(
      rawBody,
      request.headers.get("x-hub-signature-256"),
      env.WHATSAPP_APP_SECRET,
    );
    if (!valid) return json({ error: "Signature Meta invalide." }, 401);

    const payload = JSON.parse(rawBody) as {
      object?: string;
      entry?: Array<{
        changes?: Array<{
          field?: string;
          value?: {
            messages?: unknown[];
            statuses?: Array<{ id?: string; status?: string; timestamp?: string; errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }> }>;
          };
        }>;
      }>;
    };

    if (payload.object !== "whatsapp_business_account") {
      return json({ error: "Type d’événement non pris en charge." }, 400);
    }

    const changes = (payload.entry || []).flatMap(entry => entry.changes || []);
    const messageEvents = changes.reduce((count, change) => count + (change.value?.messages?.length || 0), 0);
    const statuses = changes.flatMap(change => change.value?.statuses || []);
    let persisted = 0;
    if (statuses.length) {
      if (!env.FIREBASE_SERVICE_ACCOUNT) return json({ error: "Firestore webhook non configuré." }, 503);
      const { account, token } = await createContext({
        FIREBASE_SERVICE_ACCOUNT: env.FIREBASE_SERVICE_ACCOUNT,
        MAILER_WEB_APP_URL: "",
        MAILER_SECRET: "",
      });
      for (const event of statuses) {
        const wamid = String(event.id || "");
        const nextStatus = String(event.status || "").toLowerCase();
        if (!wamid || !["sent", "delivered", "read", "failed"].includes(nextStatus)) continue;
        const index = await readDocument(account, token, "whatsapp_message_index", wamid);
        if (!index) {
          console.warn("Statut WhatsApp reçu sans index correspondant", { status: nextStatus });
          continue;
        }
        const notificationId = String(index.data.notificationId || "");
        const applicationId = String(index.data.applicationId || "");
        if (!notificationId || !applicationId) continue;
        const notification = await readDocument(account, token, "whatsapp_notifications", notificationId);
        if (!notification) continue;
        const current = String(notification.data.status || "sent");
        const rank: Record<string, number> = { processing: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
        const currentRank = rank[current] ?? 0;
        const nextRank = rank[nextStatus] ?? 0;
        if (current === "read" || (current !== "failed" && nextStatus !== "failed" && nextRank < currentRank)) continue;
        if (current === "failed" && nextStatus !== "failed") continue;
        const timestamp = event.timestamp && /^\\d+$/.test(event.timestamp)
          ? new Date(Number(event.timestamp) * 1000).toISOString()
          : new Date().toISOString();
        const patch: Record<string, unknown> = { status: nextStatus, updatedAt: new Date().toISOString() };
        if (nextStatus === "delivered") patch.deliveredAt = timestamp;
        if (nextStatus === "read") patch.readAt = timestamp;
        if (nextStatus === "failed") {
          patch.failedAt = timestamp;
          patch.errorDetails = (event.errors || []).map(error => ({
            code: Number(error.code || 0),
            title: String(error.title || ""),
            message: String(error.message || ""),
            details: String(error.error_data?.details || ""),
          }));
        }
        await updateFields(account, token, "whatsapp_notifications/" + notificationId, patch);
        await updateFields(account, token, "candidatures/" + applicationId, {
          lastWhatsappStatus: nextStatus,
          lastWhatsappStatusAt: timestamp,
          lastWhatsappNotificationId: notificationId,
        });
        persisted += 1;
      }
    }

    console.log("Événement WhatsApp reçu", {
      fields: [...new Set(changes.map(change => change.field).filter(Boolean))],
      messageEvents,
      statusEvents: statuses.length,
      persistedStatuses: persisted,
    });
    return json({ ok: true, persistedStatuses: persisted });
  } catch (error) {
    console.error("Erreur de traitement du webhook WhatsApp", error);
    return json({ error: "Événement WhatsApp invalide." }, 400);
  }
};

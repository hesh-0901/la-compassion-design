import { createContext, createDocument, readDocument, updateFields } from "./notifications";

export type WhatsAppNotificationType = "application_received" | "application_accepted" | "application_rejected";
type WhatsAppEnv = {
  FIREBASE_SERVICE_ACCOUNT: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_GRAPH_VERSION?: string;
};
type Candidate = Record<string, any> & { id: string; phone?: string; fullName?: string; whatsappConsent?: boolean };
const TEMPLATE_BY_TYPE: Record<WhatsAppNotificationType, string> = {
  application_received: "compassion_candidature_recue",
  application_accepted: "compassion_candidature_acceptee",
  application_rejected: "compassion_candidature_refusee",
};
const firstNameOf = (value: unknown) => String(value || "").trim().split(/\s+/)[0] || "Candidat";

export function normalizeWhatsAppPhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/[\s()+.-]/g, "").replace(/\D/g, "");
  return /^\d{8,15}$/.test(digits) ? digits : null;
}
const notificationId = (candidateId: string, type: WhatsAppNotificationType) => candidateId + "_" + type;

async function logSkipped(account: any, token: string, id: string, data: Record<string, unknown>) {
  try { await createDocument(account, token, "whatsapp_notifications", id, data); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Firestore REST: 409")) throw error;
  }
}

/** Sends one approved Meta template. A deterministic Firestore document reserves each event before calling Meta. */
export async function sendWhatsAppNotification(
  env: WhatsAppEnv,
  candidate: Candidate,
  type: WhatsAppNotificationType,
  groupLink = "",
): Promise<{ status: string; wamid?: string; reason?: string }> {
  const id = notificationId(candidate.id, type);
  const templateName = TEMPLATE_BY_TYPE[type];
  const now = new Date().toISOString();
  const base = { applicationId: candidate.id, type, templateName, updatedAt: now };

  const { account, token } = await createContext({
    FIREBASE_SERVICE_ACCOUNT: env.FIREBASE_SERVICE_ACCOUNT,
    MAILER_WEB_APP_URL: "",
    MAILER_SECRET: "",
  });

  if (candidate.whatsappConsent !== true) {
    await logSkipped(account, token, id, { ...base, to: "", status: "skipped_no_consent", sentAt: now });
    return { status: "skipped_no_consent" };
  }
  const to = normalizeWhatsAppPhone(candidate.phone);
  if (!to) {
    await logSkipped(account, token, id, { ...base, to: String(candidate.phone || ""), status: "failed_invalid_phone", errorMessage: "Numéro international invalide.", sentAt: now });
    return { status: "failed_invalid_phone" };
  }

  try {
    await createDocument(account, token, "whatsapp_notifications", id, {
      ...base, to, status: "processing", sentAt: now,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Firestore REST: 409")) {
      const existing = await readDocument(account, token, "whatsapp_notifications", id);
      return { status: String(existing?.data.status || "already-processed"), wamid: existing?.data.wamid };
    }
    throw error;
  }

  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    await updateFields(account, token, "whatsapp_notifications/" + id, {
      status: "failed", errorMessage: "Configuration WhatsApp Cloud API manquante.", updatedAt: new Date().toISOString(),
    });
    return { status: "failed", reason: "missing_configuration" };
  }

  const parameters = [{ type: "text", text: firstNameOf(candidate.fullName) }];
  if (type === "application_accepted") parameters.push({ type: "text", text: groupLink || "Le lien du groupe sera communiqué par l’équipe." });
  const graphVersion = (env.WHATSAPP_GRAPH_VERSION || "v26.0").replace(/^v?/, "v");
  try {
    const response = await fetch("https://graph.facebook.com/" + graphVersion + "/" + env.WHATSAPP_PHONE_NUMBER_ID + "/messages", {
      method: "POST",
      headers: { authorization: "Bearer " + env.WHATSAPP_ACCESS_TOKEN, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: "fr" },
          components: [{ type: "body", parameters }],
        },
      }),
    });
    const result = await response.json().catch(() => ({})) as {
      messages?: Array<{ id?: string }>;
      error?: { code?: number; message?: string; error_subcode?: number };
    };
    if (!response.ok || !result.messages?.[0]?.id) {
      const errorCode = result.error?.code;
      const errorMessage = result.error?.message || "Meta n’a pas confirmé l’envoi du message.";
      await updateFields(account, token, "whatsapp_notifications/" + id, {
        status: "failed", errorCode: errorCode ?? 0, errorMessage: errorMessage.slice(0, 500), updatedAt: new Date().toISOString(),
      });
      return { status: "failed", reason: String(errorCode || "meta_error") };
    }
    const wamid = result.messages[0].id;
    await updateFields(account, token, "whatsapp_notifications/" + id, {
      status: "sent", wamid, sentAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    try {
      await createDocument(account, token, "whatsapp_message_index", wamid, { notificationId: id, applicationId: candidate.id, type, createdAt: new Date().toISOString() });
    } catch (indexError) {
      console.error("Index WhatsApp non créé", { applicationId: candidate.id, type, error: indexError instanceof Error ? indexError.message : "unknown" });
    }
    return { status: "sent", wamid };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erreur réseau Meta.";
    await updateFields(account, token, "whatsapp_notifications/" + id, {
      status: "failed", errorMessage: errorMessage.slice(0, 500), updatedAt: new Date().toISOString(),
    });
    return { status: "failed", reason: "network_error" };
  }
}

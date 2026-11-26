import {
  createContext,
  createDocument,
  readDocument,
  updateFields,
  updateFieldsIfUnchanged,
} from "./notifications";

export type WhatsAppNotificationType =
  | "application_received"
  | "application_accepted"
  | "application_rejected";

type WhatsAppEnv = {
  FIREBASE_SERVICE_ACCOUNT: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_GRAPH_VERSION?: string;
};

type Candidate = Record<string, any> & {
  id: string;
  phone?: string;
  fullName?: string;
  whatsappConsent?: boolean;
};

type WhatsAppResult = {
  status: string;
  wamid?: string;
  reason?: string;
  errorCode?: number;
  errorMessage?: string;
  retryable?: boolean;
};

type MetaError = {
  code?: number;
  message?: string;
  error_subcode?: number;
  type?: string;
  fbtrace_id?: string;
};

const TEMPLATE_BY_TYPE: Record<WhatsAppNotificationType, string> = {
  application_received: "compassion_candidature_recue",
  application_accepted: "compassion_candidature_acceptee",
  application_rejected: "compassion_candidature_refusee",
};

const firstNameOf = (value: unknown) =>
  String(value || "").trim().split(/\\s+/)[0] || "Candidat";

const notificationId = (candidateId: string, type: WhatsAppNotificationType) =>
  candidateId + "_" + type;

const PROCESSING_LEASE_MS = 5 * 60 * 1000;

export function normalizeWhatsAppPhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/[\\s()+.-]/g, "").replace(/\\D/g, "");
  return /^\\d{8,15}$/.test(digits) ? digits : null;
}

async function logSkipped(
  account: any,
  token: string,
  id: string,
  data: Record<string, unknown>,
) {
  try {
    await createDocument(account, token, "whatsapp_notifications", id, data);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Firestore REST: 409")) {
      throw error;
    }
  }
}

/**
 * A deterministic notification record prevents duplicate sends.
 * A failed request can be retried only when Meta explicitly rejected it.
 * Network/timeout failures remain "unknown" because Meta may have accepted
 * the message even if the Worker did not receive the response.
 */
export async function sendWhatsAppNotification(
  env: WhatsAppEnv,
  candidate: Candidate,
  type: WhatsAppNotificationType,
  groupLink = "",
): Promise<WhatsAppResult> {
  const id = notificationId(candidate.id, type);
  const templateName = TEMPLATE_BY_TYPE[type];
  const now = new Date().toISOString();
  const base = { applicationId: candidate.id, type, templateName };

  const { account, token } = await createContext({
    FIREBASE_SERVICE_ACCOUNT: env.FIREBASE_SERVICE_ACCOUNT,
    MAILER_WEB_APP_URL: "",
    MAILER_SECRET: "",
  });

  if (candidate.whatsappConsent !== true) {
    await logSkipped(account, token, id, {
      ...base,
      to: "",
      status: "skipped_no_consent",
      sentAt: now,
      updatedAt: now,
    });
    return { status: "skipped_no_consent" };
  }

  const to = normalizeWhatsAppPhone(candidate.phone);
  if (!to) {
    await logSkipped(account, token, id, {
      ...base,
      to: String(candidate.phone || ""),
      status: "failed_invalid_phone",
      errorMessage: "Numéro international invalide.",
      retryable: false,
      sentAt: now,
      updatedAt: now,
    });
    return {
      status: "failed_invalid_phone",
      reason: "invalid_phone",
      errorMessage: "Numéro international invalide.",
    };
  }

  let attempt = 1;
  let claimed = false;

  try {
    await createDocument(account, token, "whatsapp_notifications", id, {
      ...base,
      to,
      status: "processing",
      attemptCount: attempt,
      attemptStartedAt: now,
      retryable: false,
      createdAt: now,
      updatedAt: now,
    });
    claimed = true;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Firestore REST: 409")) {
      throw error;
    }

    const existing = await readDocument(account, token, "whatsapp_notifications", id);
    if (!existing) throw new Error("Notification WhatsApp introuvable après conflit de réservation.");

    const previousStatus = String(existing.data.status || "unknown");
    if (["sent", "delivered", "read"].includes(previousStatus)) {
      return { status: previousStatus, wamid: existing.data.wamid };
    }

    const previousAttemptStartedAt = Date.parse(String(existing.data.attemptStartedAt || ""));
    const processingIsStale =
      previousStatus === "processing" &&
      Number.isFinite(previousAttemptStartedAt) &&
      Date.now() - previousAttemptStartedAt > PROCESSING_LEASE_MS;

    const canRetry =
      previousStatus === "failed" &&
      existing.data.retryable === true;

    if (!canRetry && !processingIsStale) {
      return {
        status: previousStatus,
        wamid: existing.data.wamid,
        reason: String(existing.data.errorCode || existing.data.errorReason || "already_processed"),
        errorCode: Number(existing.data.errorCode) || undefined,
        errorMessage: String(existing.data.errorMessage || "") || undefined,
        retryable: existing.data.retryable === true,
      };
    }

    if (!existing.updateTime) {
      return { status: previousStatus, reason: "missing_update_time" };
    }

    attempt = Math.max(1, Number(existing.data.attemptCount) || 1) + 1;
    claimed = await updateFieldsIfUnchanged(
      account,
      token,
      "whatsapp_notifications/" + id,
      {
        status: "processing",
        attemptCount: attempt,
        attemptStartedAt: now,
        retryable: false,
        errorCode: 0,
        errorMessage: "",
        errorSubcode: 0,
        errorType: "",
        updatedAt: now,
      },
      existing.updateTime,
    );

    if (!claimed) {
      const latest = await readDocument(account, token, "whatsapp_notifications", id);
      return {
        status: String(latest?.data.status || "processing"),
        wamid: latest?.data.wamid,
        reason: "retry_already_claimed",
      };
    }
  }

  if (!claimed) return { status: "processing", reason: "retry_not_claimed" };

  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    const errorMessage = "Configuration WhatsApp Cloud API manquante.";
    await updateFields(account, token, "whatsapp_notifications/" + id, {
      status: "failed",
      retryable: true,
      errorReason: "missing_configuration",
      errorMessage,
      updatedAt: new Date().toISOString(),
    });
    return {
      status: "failed",
      reason: "missing_configuration",
      errorMessage,
      retryable: true,
    };
  }

  const parameters = [{ type: "text", text: firstNameOf(candidate.fullName) }];
  if (type === "application_accepted") {
    parameters.push({
      type: "text",
      text: groupLink || "Le lien du groupe sera communiqué par l’équipe.",
    });
  }

  const graphVersion = (env.WHATSAPP_GRAPH_VERSION || "v26.0").replace(/^v?/, "v");

  try {
    const response = await fetch(
      "https://graph.facebook.com/" +
        graphVersion +
        "/" +
        env.WHATSAPP_PHONE_NUMBER_ID +
        "/messages",
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + env.WHATSAPP_ACCESS_TOKEN,
          "content-type": "application/json",
        },
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
      },
    );

    const result = (await response.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: MetaError;
    };

    if (!response.ok || !result.messages?.[0]?.id) {
      const metaError = result.error || {};
      const errorCode = Number(metaError.code) || 0;
      const errorMessage =
        metaError.message || "Meta n’a pas confirmé l’envoi du message.";
      const retryable = !response.ok;

      await updateFields(account, token, "whatsapp_notifications/" + id, {
        status: "failed",
        retryable,
        errorReason: "meta_rejected",
        errorCode,
        errorSubcode: Number(metaError.error_subcode) || 0,
        errorType: String(metaError.type || ""),
        fbtraceId: String(metaError.fbtrace_id || ""),
        errorMessage: errorMessage.slice(0, 500),
        updatedAt: new Date().toISOString(),
      });

      console.error("Échec WhatsApp confirmé par Meta", {
        applicationId: candidate.id,
        type,
        attempt,
        httpStatus: response.status,
        errorCode,
        errorSubcode: Number(metaError.error_subcode) || 0,
        errorType: String(metaError.type || ""),
        errorMessage: errorMessage.slice(0, 500),
        fbtraceId: String(metaError.fbtrace_id || ""),
      });

      return {
        status: "failed",
        reason: "meta_rejected",
        errorCode: errorCode || undefined,
        errorMessage: errorMessage.slice(0, 500),
        retryable,
      };
    }

    const wamid = result.messages[0].id;

    // Create the status lookup before marking the notification as sent.
    try {
      await createDocument(account, token, "whatsapp_message_index", wamid, {
        notificationId: id,
        applicationId: candidate.id,
        type,
        createdAt: new Date().toISOString(),
      });
    } catch (indexError) {
      console.error("Index WhatsApp non créé", {
        applicationId: candidate.id,
        type,
        error: indexError instanceof Error ? indexError.message : "unknown",
      });
    }

    await updateFields(account, token, "whatsapp_notifications/" + id, {
      status: "sent",
      retryable: false,
      wamid,
      sentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      errorCode: 0,
      errorMessage: "",
    });

    return { status: "sent", wamid, retryable: false };
  } catch (error) {
    // Do not retry automatically: a network timeout can happen after Meta accepted the message.
    const errorMessage =
      error instanceof Error ? error.message : "Erreur réseau Meta.";
    await updateFields(account, token, "whatsapp_notifications/" + id, {
      status: "unknown",
      retryable: false,
      errorReason: "ambiguous_network_failure",
      errorMessage: errorMessage.slice(0, 500),
      updatedAt: new Date().toISOString(),
    });

    console.error("Résultat WhatsApp indéterminé", {
      applicationId: candidate.id,
      type,
      attempt,
      errorMessage: errorMessage.slice(0, 500),
    });

    return {
      status: "unknown",
      reason: "ambiguous_network_failure",
      errorMessage: errorMessage.slice(0, 500),
      retryable: false,
    };
  }
}

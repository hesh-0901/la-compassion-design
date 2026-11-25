import { authenticateFirebaseUser, createContext, escapeHtml, readDocument, sendEmail, updateFields, jsonResponse } from "../_shared/notifications";

type Env = { FIREBASE_SERVICE_ACCOUNT: string; MAILER_WEB_APP_URL: string; MAILER_SECRET: string };

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    const { account, token } = await createContext(env);
    const uid = await authenticateFirebaseUser(request, account.project_id);
    const adminDoc = await readDocument(account, token, "admins", uid);
    if (!adminDoc || adminDoc.data.active !== true || !["admin", "superAdmin"].includes(adminDoc.data.role)) {
      return jsonResponse({ error: "Administrateur non autorisé." }, 403);
    }

    const body = await request.json() as { candidateId?: string; status?: string };
    const candidateId = String(body.candidateId || "");
    const nextStatus = String(body.status || "");
    if (!/^[A-Za-z0-9_-]{10,150}$/.test(candidateId) || !["accepted", "refused"].includes(nextStatus)) {
      return jsonResponse({ error: "Données de notification invalides." }, 400);
    }

    const candidateDoc = await readDocument(account, token, "candidatures", candidateId);
    if (!candidateDoc) return jsonResponse({ error: "Candidature introuvable." }, 404);
    const candidate = candidateDoc.data;
    if (candidate.status !== nextStatus) return jsonResponse({ error: "Le statut Firestore ne correspond pas à la décision demandée." }, 409);
    if (candidate.statusNotificationSentFor === nextStatus) return jsonResponse({ ok: true, notification: "already-sent" });
    const email = typeof candidate.email === "string" ? candidate.email.trim() : "";
    if (!email) return jsonResponse({ ok: true, notification: "no-email" });

    const accepted = nextStatus === "accepted";
    const name = escapeHtml(candidate.fullName || "Candidat");
    const configDoc = accepted ? await readDocument(account, token, "configuration", "masterclass") : null;
    const rawWhatsappLink = typeof configDoc?.data.whatsappGroupLink === "string" ? configDoc.data.whatsappGroupLink.trim() : "";
    const whatsappLink = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+\/?$/.test(rawWhatsappLink) ? rawWhatsappLink : "";
    const subject = accepted ? "Candidature acceptée – Masterclass Design" : "Décision concernant votre candidature – Masterclass Design";
    const html = accepted ? `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033">
        <h2>Félicitations, votre candidature est acceptée.</h2>
        <p>Bonjour ${name},</p>
        <p>Nous avons le plaisir de vous informer que votre candidature à la Masterclass Design de l’Église de la Compassion a été acceptée.</p>
        <p>Nous vous invitons à rejoindre le groupe WhatsApp officiel pour recevoir les informations pratiques et les communications liées à la formation.</p>
        ${whatsappLink ? `<p style="margin:28px 0"><a href="${escapeHtml(whatsappLink)}" style="display:inline-block;padding:15px 24px;background:#16834b;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:bold">REJOINDRE LE GROUPE WHATSAPP</a></p>` : `<p style="padding:14px;background:#fff7e6;border-radius:8px">Le lien du groupe WhatsApp vous sera communiqué prochainement par l’équipe.</p>`}
        <p>15–19 décembre 2026 · 19h00–22h00</p>
        <p>Merci,<br><strong>Équipe LA COMPASSION DESIGN</strong></p>
      </div>` : `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033">
        <h2>Mise à jour de votre candidature</h2>
        <p>Bonjour ${name},</p>
        <p>Après examen de votre dossier, nous ne sommes malheureusement pas en mesure de retenir votre candidature pour cette session de la Masterclass Design.</p>
        <p>Nous vous remercions pour votre intérêt et votre compréhension.</p>
        <p><strong>Équipe LA COMPASSION DESIGN</strong></p>
      </div>`;
    const messageId = await sendEmail(env, email, subject, html, "candidate-status-" + candidateId + "-" + nextStatus);
    await updateFields(account, token, "candidatures/" + candidateId, { statusNotificationSentFor: nextStatus, statusNotificationSentAt: new Date().toISOString() });
    console.log("Notification de décision envoyée", { candidateId, status: nextStatus, messageId });
    return jsonResponse({ ok: true, notification: "sent", messageId });
  } catch (error) {
    console.error("Échec notification de décision", error);
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "Erreur interne." }, 500);
  }
};

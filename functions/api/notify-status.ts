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
    const subject = accepted ? "Candidature acceptée – Masterclass Design" : "Décision concernant votre candidature – Masterclass Design";
    const html = accepted ? `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033">
        <h2>Félicitations, votre candidature est acceptée.</h2>
        <p>Bonjour ${name},</p>
        <p>Nous avons le plaisir de vous informer que votre candidature à la Masterclass Design de l’Église de la Compassion a été acceptée.</p>
        <p>Les informations pratiques complémentaires vous seront communiquées par l’équipe.</p>
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
    return jsonResponse({ ok: true, notification: "sent", messageId });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Erreur interne." }, 500);
  }
};

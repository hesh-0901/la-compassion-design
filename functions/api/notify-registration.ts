import { createContext, escapeHtml, listActiveSuperAdmins, readDocument, sendEmail, updateFields, jsonResponse } from "../_shared/notifications";

type Env = { FIREBASE_SERVICE_ACCOUNT: string; MAILER_WEB_APP_URL: string; MAILER_SECRET: string };

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    const body = await request.json() as { candidateId?: string };
    const candidateId = String(body.candidateId || "");
    if (!/^[A-Za-z0-9_-]{10,150}$/.test(candidateId)) return jsonResponse({ error: "Identifiant de candidature invalide." }, 400);

    const { account, token } = await createContext(env);
    const candidateDoc = await readDocument(account, token, "candidatures", candidateId);
    if (!candidateDoc) return jsonResponse({ error: "Candidature introuvable." }, 404);
    const candidate = candidateDoc.data;
    if (candidate.status !== "received") return jsonResponse({ error: "Statut de candidature inattendu." }, 409);

    const admins = await listActiveSuperAdmins(account, token);
    if (!admins.length) return jsonResponse({ error: "Aucun super administrateur actif avec une adresse e-mail dans Firestore." }, 500);

    const name = escapeHtml(candidate.fullName || "Candidat");
    const email = typeof candidate.email === "string" ? candidate.email.trim() : "";
    const phone = escapeHtml(candidate.phone || "Non renseigné");
    const level = escapeHtml(candidate.level || "Non renseigné");
    const createdAt = escapeHtml(candidate.createdAt || new Date().toISOString());
    const alreadyAdminNotified = Boolean(candidate.adminNotificationSentAt);
    const alreadyCandidateNotified = Boolean(candidate.candidateConfirmationSentAt);
    const results: Record<string, string> = {};

    if (email && !alreadyCandidateNotified) {
      try {
        await sendEmail(env, email, "Candidature reçue – Masterclass Design", `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033">
            <h2>Nous avons bien reçu votre candidature.</h2>
            <p>Bonjour ${name},</p>
            <p>Votre inscription à la Masterclass Design de l’Église de la Compassion a été enregistrée.</p>
            <p>Votre dossier sera examiné par l’équipe. Vous recevrez un autre message lorsque la décision sera prise.</p>
            <p>Merci,<br><strong>Équipe LA COMPASSION DESIGN</strong></p>
          </div>`, "candidate-receipt-" + candidateId);
        await updateFields(account, token, "candidatures/" + candidateId, { candidateConfirmationSentAt: new Date().toISOString() });
        results.candidate = "sent";
      } catch (error) {
        results.candidate = error instanceof Error ? error.message : "Échec de l'envoi";
      }
    } else results.candidate = email ? "already-sent" : "no-email";

    if (!alreadyAdminNotified) {
      const subject = "Nouvelle candidature – " + String(candidate.fullName || "Masterclass Design");
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033">
          <h2>Nouvelle candidature reçue</h2>
          <p>Une nouvelle inscription vient d’être enregistrée dans LA COMPASSION DESIGN.</p>
          <table cellpadding="7" style="border-collapse:collapse">
            <tr><td><strong>Nom</strong></td><td>${name}</td></tr>
            <tr><td><strong>Téléphone</strong></td><td>${phone}</td></tr>
            <tr><td><strong>E-mail</strong></td><td>${escapeHtml(email || "Non renseigné")}</td></tr>
            <tr><td><strong>Niveau design</strong></td><td>${level}</td></tr>
            <tr><td><strong>Date</strong></td><td>${createdAt}</td></tr>
          </table>
          <p>Connecte-toi à l’espace d’administration pour consulter le dossier complet.</p>
        </div>`;
      const sent: string[] = [];
      const failures: string[] = [];
      for (const admin of admins) {
        try {
          await sendEmail(env, admin.email, subject, html, "admin-new-" + candidateId + "-" + admin.id);
          sent.push(admin.email);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : "Échec de l'envoi");
        }
      }
      if (sent.length) {
        await updateFields(account, token, "candidatures/" + candidateId, { adminNotificationSentAt: new Date().toISOString() });
        results.admin = "sent:" + sent.length;
      } else results.admin = failures[0] || "failed";
      if (failures.length) console.error("Échec notification administrateur", { candidateId, sent: sent.length, failures });
    } else results.admin = "already-sent";

    const candidateOk = results.candidate === "sent" || results.candidate === "already-sent" || results.candidate === "no-email";
    const adminOk = results.admin === "already-sent" || results.admin.startsWith("sent:");
    const ok = candidateOk && adminOk;
    if (!ok) console.error("Notifications d'inscription incomplètes", { candidateId, notifications: results });
    return jsonResponse({ ok, notifications: results }, ok ? 200 : 502);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Erreur interne." }, 500);
  }
};

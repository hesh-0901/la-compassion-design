import { createContext, escapeHtml, listActiveSuperAdmins, readDocument, sendEmail, updateFields, jsonResponse } from "../_shared/notifications";

type Env = { FIREBASE_SERVICE_ACCOUNT: string; MAILER_WEB_APP_URL: string; MAILER_SECRET: string };

const firstNameOf = (fullName: unknown) => {
  const name = String(fullName || "").trim();
  return name ? name.split(/\s+/)[0] : "Candidat";
};

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

    const firstName = escapeHtml(firstNameOf(candidate.fullName));
    const fullName = escapeHtml(candidate.fullName || "Candidat");
    const email = typeof candidate.email === "string" ? candidate.email.trim() : "";
    const phone = escapeHtml(candidate.phone || "Non renseigné");
    const level = escapeHtml(candidate.level || "Non renseigné");
    const extension = escapeHtml(candidate.extension || "Non renseignée");
    const department = escapeHtml(candidate.department || "Non renseigné");
    const createdAt = escapeHtml(candidate.createdAt || new Date().toISOString());
    const alreadyAdminNotified = Boolean(candidate.adminNotificationSentAt);
    const alreadyCandidateNotified = Boolean(candidate.candidateConfirmationSentAt);
    const results: Record<string, string> = {};

    if (email && !alreadyCandidateNotified) {
      try {
        await sendEmail(env, email, `${firstName}, votre candidature à la Masterclass Design est bien reçue`, `
          <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172033;line-height:1.65">
            <div style="padding:26px 30px;background:#103d2b;border-radius:14px 14px 0 0;color:#fff">
              <p style="margin:0 0 8px;font-size:12px;letter-spacing:2px;font-weight:bold">LA COMPASSION DESIGN</p>
              <h2 style="margin:0;font-size:24px">Candidature enregistrée</h2>
            </div>
            <div style="padding:28px 30px;border:1px solid #e6e9ed;border-top:0;border-radius:0 0 14px 14px">
              <p>Bonjour <strong>${firstName}</strong>,</p>
              <p>Nous confirmons la bonne réception de votre candidature à la <strong>Masterclass Design de l’Église de la Compassion</strong>.</p>
              <div style="margin:22px 0;padding:18px;background:#f3f7f4;border-radius:10px">
                <strong>Votre dossier est maintenant enregistré.</strong><br>
                Statut : <strong>En attente d’examen</strong>
              </div>
              <p>L’équipe va examiner les candidatures. Vous recevrez un message personnalisé dès qu’une décision sera prise. La réception de ce courriel ne constitue pas encore une confirmation de participation.</p>
              <p>En attendant, gardez votre téléphone accessible et préparez-vous à respecter les conditions pratiques de la formation, notamment la disponibilité du 15 au 19 décembre 2026, de 19h00 à 22h00.</p>
              <p>Merci pour votre intérêt et votre confiance.</p>
              <p><strong>L’équipe LA COMPASSION DESIGN</strong></p>
            </div>
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
        <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172033;line-height:1.6">
          <div style="padding:24px 28px;background:#263449;border-radius:12px 12px 0 0;color:#fff">
            <p style="margin:0 0 6px;font-size:12px;letter-spacing:2px;font-weight:bold">ESPACE SUPERVISION</p>
            <h2 style="margin:0">Nouvelle candidature à examiner</h2>
          </div>
          <div style="padding:24px 28px;border:1px solid #e6e9ed;border-top:0;border-radius:0 0 12px 12px">
            <p>Une nouvelle candidature vient d’être enregistrée. Merci de consulter le dossier et de statuer depuis l’espace d’administration.</p>
            <table cellpadding="8" style="width:100%;border-collapse:collapse;background:#f7f8fa">
              <tr><td><strong>Nom complet</strong></td><td>${fullName}</td></tr>
              <tr><td><strong>Téléphone</strong></td><td>${phone}</td></tr>
              <tr><td><strong>E-mail</strong></td><td>${escapeHtml(email || "Non renseigné")}</td></tr>
              <tr><td><strong>Extension</strong></td><td>${extension}</td></tr>
              <tr><td><strong>Département</strong></td><td>${department}</td></tr>
              <tr><td><strong>Niveau en design</strong></td><td>${level}</td></tr>
              <tr><td><strong>Reçue le</strong></td><td>${createdAt}</td></tr>
            </table>
            <p style="margin-top:20px">Connectez-vous à l’espace SuperAdmin pour examiner les informations complètes, puis accepter ou refuser la candidature.</p>
            <p><strong>LA COMPASSION DESIGN</strong></p>
          </div>
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

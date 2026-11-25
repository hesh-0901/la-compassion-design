import { authenticateFirebaseUser, createContext, escapeHtml, readDocument, sendEmail, updateFields, jsonResponse } from "../_shared/notifications";

type Env = { FIREBASE_SERVICE_ACCOUNT: string; MAILER_WEB_APP_URL: string; MAILER_SECRET: string };

const firstNameOf = (fullName: unknown) => {
  const name = String(fullName || "").trim();
  return name ? name.split(/\\s+/)[0] : "Candidat";
};

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
    const firstName = escapeHtml(firstNameOf(candidate.fullName));
    const fullName = escapeHtml(candidate.fullName || "Candidat");
    const configDoc = accepted ? await readDocument(account, token, "configuration", "masterclass") : null;
    const rawWhatsappLink = typeof configDoc?.data.whatsappGroupLink === "string" ? configDoc.data.whatsappGroupLink.trim() : "";
    const whatsappLink = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+\/?$/.test(rawWhatsappLink) ? rawWhatsappLink : "";
    const subject = accepted
      ? `Félicitations ${firstName} : votre place est confirmée !`
      : `Suite à votre candidature, ${firstName}`;
    const html = accepted ? `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172033;line-height:1.65">
        <div style="padding:28px 30px;background:#103d2b;border-radius:14px 14px 0 0;color:#fff">
          <p style="margin:0 0 8px;font-size:12px;letter-spacing:2px;font-weight:bold">LA COMPASSION DESIGN</p>
          <h2 style="margin:0;font-size:25px">Votre candidature est acceptée !</h2>
        </div>
        <div style="padding:28px 30px;border:1px solid #e6e9ed;border-top:0;border-radius:0 0 14px 14px">
          <p>Bonjour <strong>${firstName}</strong>,</p>
          <p>Nous avons le plaisir de vous annoncer que votre candidature à la <strong>Masterclass Design de l’Église de la Compassion</strong> a été retenue.</p>
          <p>Cette confirmation marque le début de votre parcours. Nous comptons sur votre ponctualité, votre implication et votre engagement tout au long de cette formation intensive.</p>
          <div style="margin:22px 0;padding:18px;background:#f3f7f4;border-radius:10px">
            <strong>Vos rendez-vous</strong><br>
            Du 15 au 19 décembre 2026<br>
            Chaque soir, de 19h00 à 22h00
          </div>
          <h3 style="margin-bottom:8px">Prochaine étape : rejoindre le groupe WhatsApp</h3>
          <p>Rejoignez le groupe officiel afin de recevoir les consignes, les informations pratiques et les communications de l’équipe.</p>
          ${whatsappLink ? `
            <p style="margin:24px 0"><a href="${escapeHtml(whatsappLink)}" style="display:inline-block;padding:14px 22px;background:#16834b;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">REJOINDRE LE GROUPE WHATSAPP</a></p>
            <p style="font-size:13px;color:#596579">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br><a href="${escapeHtml(whatsappLink)}">${escapeHtml(whatsappLink)}</a></p>
          ` : `<p style="padding:14px;background:#fff7e6;border-radius:8px">Le lien du groupe WhatsApp n’est pas encore disponible. L’équipe vous le communiquera dès que possible.</p>`}
          <p>Nous sommes heureux de vous compter parmi les participants.</p>
          <p>À très bientôt,<br><strong>L’équipe LA COMPASSION DESIGN</strong></p>
        </div>
      </div>` : `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172033;line-height:1.65">
        <div style="padding:26px 30px;background:#263449;border-radius:14px 14px 0 0;color:#fff">
          <p style="margin:0 0 8px;font-size:12px;letter-spacing:2px;font-weight:bold">LA COMPASSION DESIGN</p>
          <h2 style="margin:0;font-size:24px">Retour sur votre candidature</h2>
        </div>
        <div style="padding:28px 30px;border:1px solid #e6e9ed;border-top:0;border-radius:0 0 14px 14px">
          <p>Bonjour <strong>${firstName}</strong>,</p>
          <p>Nous vous remercions d’avoir pris le temps de présenter votre candidature à la Masterclass Design de l’Église de la Compassion.</p>
          <p>Après étude des dossiers, nous sommes au regret de vous informer que votre candidature n’a pas été retenue pour cette session.</p>
          <p>Cette décision concerne uniquement la session actuelle et ne remet pas en question votre intérêt pour le design ni votre volonté de progresser. Nous vous encourageons à poursuivre votre apprentissage et à rester attentif aux prochaines opportunités.</p>
          <p>Merci pour votre confiance et votre compréhension.</p>
          <p>Respectueusement,<br><strong>L’équipe LA COMPASSION DESIGN</strong></p>
        </div>
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

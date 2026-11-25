import { createContext, jsonResponse } from "../_shared/notifications";

type Env = { FIREBASE_SERVICE_ACCOUNT: string; MAILER_WEB_APP_URL: string; MAILER_SECRET: string };

const normalize = (value: unknown) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const decode = (field: any): string => {
  if (!field) return "";
  if (typeof field.stringValue === "string") return field.stringValue;
  return "";
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    const body = await request.json() as { fullName?: string; email?: string; phone?: string };
    const name = normalize(body.fullName);
    const email = normalize(body.email);
    const phone = normalize(body.phone);
    if (!name || !phone) return jsonResponse({ error: "Le nom complet et le numéro de téléphone sont obligatoires pour vérifier les doublons." }, 400);

    const { account, token } = await createContext(env);
    let pageToken = "";
    const matches: Array<{ field: string; value: string }> = [];
    do {
      const params = new URLSearchParams({ pageSize: "1000" });
      if (pageToken) params.set("pageToken", pageToken);
      const url = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(account.project_id) + "/databases/(default)/documents/candidatures?" + params.toString();
      const response = await fetch(url, { headers: { authorization: "Bearer " + token } });
      if (!response.ok) throw new Error("Lecture des candidatures impossible : " + response.status);
      const data = await response.json() as { documents?: Array<{ name: string; fields?: Record<string, any> }>; nextPageToken?: string };
      for (const doc of data.documents || []) {
        const fields = doc.fields || {};
        const existingName = normalize(decode(fields.fullName));
        const existingEmail = normalize(decode(fields.email));
        const existingPhone = normalize(decode(fields.phone));
        if (email && existingEmail && email === existingEmail) matches.push({ field: "email", value: decode(fields.email) });
        if (name && existingName && name === existingName) matches.push({ field: "fullName", value: decode(fields.fullName) });
        if (phone && existingPhone && phone === existingPhone) matches.push({ field: "phone", value: decode(fields.phone) });
        if (matches.length) break;
      }
      if (matches.length) break;
      pageToken = data.nextPageToken || "";
    } while (pageToken);

    if (matches.length) {
      const fields = [...new Set(matches.map(match => match.field))];
      const messages: Record<string, string> = {
        email: "Cette adresse e-mail est déjà utilisée pour une candidature.",
        fullName: "Une candidature existe déjà avec ce nom complet.",
        phone: "Ce numéro de téléphone est déjà associé à une candidature.",
      };
      return jsonResponse({ duplicate: true, fields, message: fields.map(field => messages[field]).join(" ") }, 409);
    }
    return jsonResponse({ duplicate: false });
  } catch (error) {
    console.error("Vérification des doublons impossible", error);
    return jsonResponse({ error: "Impossible de vérifier les doublons pour le moment. Réessaie dans un instant." }, 503);
  }
};

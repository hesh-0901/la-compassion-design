import { createContext, readDocument, jsonResponse } from "../_shared/notifications";

type Env = { FIREBASE_SERVICE_ACCOUNT: string; MAILER_WEB_APP_URL: string; MAILER_SECRET: string };

export const onRequestGet = async ({ env }: { env: Env }) => {
  try {
    const { account, token } = await createContext(env);
    const config = await readDocument(account, token, "configuration", "masterclass");
    let currentCandidates = 0;
    let pageToken = "";
    do {
      const query = new URLSearchParams({ pageSize: "1000" });
      if (pageToken) query.set("pageToken", pageToken);
      const url = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(account.project_id) + "/databases/(default)/documents/candidatures?" + query.toString();
      const response = await fetch(url, { headers: { authorization: "Bearer " + token } });
      if (!response.ok) throw new Error("Lecture des candidatures impossible : " + response.status);
      const data = await response.json() as { documents?: unknown[]; nextPageToken?: string };
      currentCandidates += (data.documents || []).length;
      pageToken = data.nextPageToken || "";
    } while (pageToken);
    const rawCapacity = config?.data.capacity;
    const capacityNumber = Number(rawCapacity);
    const capacity = rawCapacity !== null && rawCapacity !== undefined && rawCapacity !== "" && Number.isInteger(capacityNumber) && capacityNumber > 0 ? capacityNumber : null;
    const rawLink = typeof config?.data.whatsappGroupLink === "string" ? config.data.whatsappGroupLink : "";
    const whatsappGroupLink = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+\/?$/.test(rawLink) ? rawLink : "";
    return jsonResponse({ capacity, currentCandidates, whatsappGroupLink, closed: capacity !== null && currentCandidates >= capacity });
  } catch (error) {
    console.error("Lecture configuration publique impossible", error);
    return jsonResponse({ error: "Configuration temporairement indisponible." }, 503);
  }
};

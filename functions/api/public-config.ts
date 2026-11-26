import { createContext, readDocument, jsonResponse } from "../_shared/notifications";

type Env = { FIREBASE_SERVICE_ACCOUNT: string; MAILER_WEB_APP_URL: string; MAILER_SECRET: string };

export const onRequestGet = async ({ env }: { env: Env }) => {
  try {
    const { account, token } = await createContext(env);
    const config = await readDocument(account, token, "configuration", "masterclass");
    let currentCandidates = 0;
    // Firestore aggregation counts documents server-side without downloading every candidature.
    const aggregationUrl = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(account.project_id) + "/databases/(default)/documents:runAggregationQuery";
    const aggregationResponse = await fetch(aggregationUrl, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({
        structuredAggregationQuery: {
          structuredQuery: { from: [{ collectionId: "candidatures" }] },
          aggregations: [{ count: {}, alias: "total" }],
        },
      }),
    });
    if (aggregationResponse.ok) {
      const aggregationData = await aggregationResponse.json() as
        | { result?: { aggregateFields?: { total?: { integerValue?: string } } } }
        | Array<{ result?: { aggregateFields?: { total?: { integerValue?: string } } } }>;
      const aggregationResult = Array.isArray(aggregationData) ? aggregationData[0]?.result : aggregationData.result;
      currentCandidates = Number(aggregationResult?.aggregateFields?.total?.integerValue || 0);
      if (!Number.isFinite(currentCandidates)) throw new Error("Réponse de comptage Firestore invalide.");
    } else {
      // Compatibility fallback: keep the previous read path if aggregation is unavailable
      // in the target Firestore environment. This is read-only and preserves old records.
      console.warn("Agrégation Firestore indisponible, utilisation du comptage paginé :", aggregationResponse.status);
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
    }
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

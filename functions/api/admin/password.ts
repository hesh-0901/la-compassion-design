import { authenticateFirebaseUser, createAdminServiceContext, readDocument, updateFirebaseAuthPassword, jsonResponse } from "../../_shared/notifications";

type Env = { FIREBASE_SERVICE_ACCOUNT: string; FIREBASE_API_KEY: string };

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    if (!env.FIREBASE_API_KEY) return jsonResponse({ error: "FIREBASE_API_KEY manquant dans Cloudflare." }, 500);
    const { account, token } = await createAdminServiceContext(env);
    const projectId = account.project_id;
    const actorUid = await authenticateFirebaseUser(request, projectId);
    const actor = await readDocument(account, token, "admins", actorUid);
    if (!actor || actor.data.active !== true || actor.data.role !== "superAdmin") {
      return jsonResponse({ error: "Seul un SuperAdmin actif peut modifier un mot de passe." }, 403);
    }

    const body = await request.json() as { adminId?: string; password?: string };
    const adminId = String(body.adminId || "").trim();
    const password = String(body.password || "");
    if (!adminId) return jsonResponse({ error: "Administrateur non précisé." }, 400);
    if (password.length < 8 || password.length > 128) return jsonResponse({ error: "Le nouveau mot de passe doit contenir entre 8 et 128 caractères." }, 400);
    const target = await readDocument(account, token, "admins", adminId);
    if (!target) return jsonResponse({ error: "Administrateur introuvable." }, 404);
    if (target.data.role === "superAdmin") return jsonResponse({ error: "La modification du mot de passe d’un SuperAdmin est interdite depuis cet espace." }, 403);

    await updateFirebaseAuthPassword(projectId, env.FIREBASE_API_KEY, token, adminId, password);
    console.log("Mot de passe administrateur modifié", { adminId, changedBy: actorUid });
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("Échec changement mot de passe administrateur", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Erreur interne." }, 500);
  }
};

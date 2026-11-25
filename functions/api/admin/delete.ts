import { authenticateFirebaseUser, createAdminServiceContext, deleteAdminProfile, deleteFirebaseAuthUser, readDocument, jsonResponse } from "../../_shared/notifications";

type Env = { FIREBASE_SERVICE_ACCOUNT: string; FIREBASE_API_KEY: string };

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    if (!env.FIREBASE_API_KEY) return jsonResponse({ error: "FIREBASE_API_KEY manquant dans Cloudflare." }, 500);
    const { account, token } = await createAdminServiceContext(env);
    const projectId = account.project_id;
    const actorUid = await authenticateFirebaseUser(request, projectId);
    const actor = await readDocument(account, token, "admins", actorUid);
    if (!actor || actor.data.active !== true || actor.data.role !== "superAdmin") {
      return jsonResponse({ error: "Seul un SuperAdmin actif peut supprimer un administrateur." }, 403);
    }

    const body = await request.json() as { adminId?: string };
    const adminId = String(body.adminId || "").trim();
    if (!adminId || adminId === actorUid) return jsonResponse({ error: "Tu ne peux pas supprimer ton propre compte." }, 400);
    const target = await readDocument(account, token, "admins", adminId);
    if (!target) return jsonResponse({ error: "Administrateur introuvable." }, 404);
    if (target.data.role === "superAdmin") return jsonResponse({ error: "La suppression d’un compte SuperAdmin est interdite depuis cet espace." }, 403);

    await deleteFirebaseAuthUser(projectId, env.FIREBASE_API_KEY, token, adminId);
    await deleteAdminProfile(account, token, adminId);
    console.log("Compte administrateur supprimé", { adminId, deletedBy: actorUid });
    return jsonResponse({ ok: true, deletedId: adminId });
  } catch (error) {
    console.error("Échec suppression administrateur", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Erreur interne." }, 500);
  }
};

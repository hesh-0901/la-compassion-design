import {
  authenticateFirebaseUser,
  createAdminProfile,
  createAdminServiceContext,
  createFirebaseAuthUser,
  deleteFirebaseAuthUser,
  readDocument,
  jsonResponse,
} from "../../_shared/notifications";

type Env = {
  FIREBASE_SERVICE_ACCOUNT: string;
  FIREBASE_API_KEY: string;
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  let createdUid = "";
  let accessToken = "";
  let projectId = "";
  try {
    if (!env.FIREBASE_API_KEY) {
      return jsonResponse({ error: "La variable FIREBASE_API_KEY est absente de Cloudflare Pages." }, 500);
    }

    const { account, token } = await createAdminServiceContext(env);
    projectId = account.project_id;
    accessToken = token;

    const uid = await authenticateFirebaseUser(request, projectId);
    const adminDoc = await readDocument(account, token, "admins", uid);
    if (!adminDoc || adminDoc.data.active !== true || adminDoc.data.role !== "superAdmin") {
      return jsonResponse({ error: "Seul un SuperAdmin actif peut créer un administrateur." }, 403);
    }

    const body = await request.json() as {
      firstName?: string;
      lastName?: string;
      email?: string;
      password?: string;
    };
    const firstName = String(body.firstName || "").trim().replace(/\s+/g, " ");
    const lastName = String(body.lastName || "").trim().replace(/\s+/g, " ");
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (firstName.length < 2 || firstName.length > 60 || lastName.length < 2 || lastName.length > 60) {
      return jsonResponse({ error: "Le prénom et le nom doivent contenir entre 2 et 60 caractères." }, 400);
    }
    if (!/^[^\s@]+@design\.cmps$/.test(email)) {
      return jsonResponse({ error: "L’adresse de connexion doit être une adresse @design.cmps générée par l’application." }, 400);
    }
    if (password.length < 8 || password.length > 128) {
      return jsonResponse({ error: "Le mot de passe temporaire doit contenir entre 8 et 128 caractères." }, 400);
    }

    const displayName = firstName + " " + lastName;
    createdUid = await createFirebaseAuthUser(projectId, env.FIREBASE_API_KEY, token, { email, password, displayName });

    try {
      await createAdminProfile(account, token, createdUid, { firstName, lastName, email });
    } catch (profileError) {
      try {
        await deleteFirebaseAuthUser(projectId, env.FIREBASE_API_KEY, token, createdUid);
      } catch (rollbackError) {
        console.error("Échec du rollback du compte Auth après erreur Firestore", { uid: createdUid, error: rollbackError });
      }
      throw profileError;
    }

    console.log("Compte administrateur créé", { uid: createdUid, email, createdBy: uid });
    return jsonResponse({ ok: true, uid: createdUid, email, role: "admin", active: true }, 201);
  } catch (error) {
    console.error("Échec de création administrateur", error);
    const message = error instanceof Error ? error.message : "Erreur interne.";
    return jsonResponse({ error: message }, 500);
  }
};

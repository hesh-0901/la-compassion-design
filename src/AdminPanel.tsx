import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

type Role = "superAdmin" | "admin";
type Candidate = Record<string, any> & { id: string; fullName?: string; email?: string; phone?: string; status?: string };
type Tab = "overview" | "candidates" | "downloads";

function csvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}
function downloadCsv(rows: Candidate[]) {
  const fields = ["fullName","gender","phone","email","area","age","member","extension","attendance","department","maturity","level","tools","portfolio","ram","availability","motivation","commitment","status"];
  const csv = [fields.join(","), ...rows.map(row => fields.map(field => csvCell(row[field])).join(","))].join("\r\n");
  const blob = new Blob(["\\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "la-compassion-design-candidatures.csv"; anchor.click();
  URL.revokeObjectURL(url);
}

export default function AdminPanel({ onHome }: { onHome: () => void }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [rows, setRows] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [edit, setEdit] = useState({ fullName: "", phone: "", email: "", area: "" });
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async current => {
      setUser(current);
      setRole(null);
      if (!current) return;
      try {
        const adminDoc = await getDoc(doc(db, "admins", current.uid));
        const data = adminDoc.data();
        if (adminDoc.exists() && data?.active === true && (data?.role === "admin" || data?.role === "superAdmin")) {
          setRole(data.role);
        } else {
          setError("Ce compte n'est pas autorisé à accéder à l'administration.");
          await signOut(auth);
        }
      } catch {
        setError("Impossible de vérifier les droits administrateur. Vérifie les règles Firestore.");
        await signOut(auth);
      }
    });
    return unsubscribe;
  }, []);

  const loadCandidates = async () => {
    setBusy(true); setError("");
    try {
      const snapshot = await getDocs(collection(db, "candidatures"));
      const items = snapshot.docs.map(item => ({ id: item.id, ...item.data() })) as Candidate[];
      items.sort((a,b) => {
        const da = a.createdAt?.toMillis?.() ?? 0, dbb = b.createdAt?.toMillis?.() ?? 0;
        return dbb - da;
      });
      setRows(items);
    } catch {
      setError("Lecture impossible. Vérifie que la collection « candidatures » existe et que les règles Firestore autorisent cet administrateur.");
    } finally { setBusy(false); }
  };

  useEffect(() => { if (user && role) void loadCandidates(); }, [user, role]);

  const counts = useMemo(() => ({
    total: rows.length,
    pending: rows.filter(row => !row.status || row.status === "pending").length,
    approved: rows.filter(row => row.status === "approved").length,
    rejected: rows.filter(row => row.status === "rejected").length,
  }), [rows]);

  const login = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await signInWithEmailAndPassword(auth, email.trim(), password); setPassword(""); }
    catch { setError("Connexion impossible. Vérifie ton adresse e-mail et ton mot de passe."); }
    finally { setBusy(false); }
  };

  const changeStatus = async (candidate: Candidate, status: "approved" | "rejected") => {
    try {
      await updateDoc(doc(db, "candidatures", candidate.id), { status, reviewedAt: new Date(), reviewedBy: user?.uid ?? null });
      setRows(prev => prev.map(row => row.id === candidate.id ? { ...row, status } : row));
      setNotice(status === "approved" ? "Candidature approuvée." : "Candidature désapprouvée.");
    } catch { setError("Modification refusée par Firestore. Vérifie les règles de sécurité."); }
  };

  const openEdit = (candidate: Candidate) => {
    setSelected(candidate);
    setEdit({ fullName: candidate.fullName ?? "", phone: candidate.phone ?? "", email: candidate.email ?? "", area: candidate.area ?? "" });
  };
  const saveEdit = async () => {
    if (!selected) return;
    try {
      await updateDoc(doc(db, "candidatures", selected.id), edit);
      setRows(prev => prev.map(row => row.id === selected.id ? { ...row, ...edit } : row));
      setSelected(null); setNotice("Informations du candidat mises à jour.");
    } catch { setError("Modification impossible. Vérifie les règles Firestore."); }
  };

  const assets = rows.flatMap(row => [
    row.profilePhotoUrl || row.photoUrl ? { name: row.fullName || "Candidat", label: "Photo de profil", url: row.profilePhotoUrl || row.photoUrl } : null,
    row.portfolioFileUrl || row.portfolioUrl ? { name: row.fullName || "Candidat", label: "Création / portfolio", url: row.portfolioFileUrl || row.portfolioUrl } : null,
  ].filter(Boolean) as { name: string; label: string; url: string }[]);

  if (!user || !role) return <section className="admin-screen flow-screen">
    <header className="brand-row"><span className="brand-mark">C</span><span>LA COMPASSION <b>DESIGN</b></span></header>
    <button className="back-button" onClick={onHome}>← Retour à l’accueil</button>
    <form className="admin-login-card" onSubmit={login}>
      <span className="eyebrow">ESPACE PRIVÉ</span>
      <h1>Administration</h1>
      <p>Connecte-toi avec ton compte administrateur.</p>
      <label>Adresse e-mail<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
      <label>Mot de passe<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <button className="button button-primary" disabled={busy}>{busy ? "Connexion…" : "Se connecter"}</button>
    </form>
  </section>;

  return <section className="admin-screen flow-screen">
    <header className="admin-topbar">
      <div className="brand-row"><span className="brand-mark">C</span><span>LA COMPASSION <b>DESIGN</b></span></div>
      <div className="admin-account"><span>{user.email}</span><b className={role === "superAdmin" ? "role-super" : "role-admin"}>{role === "superAdmin" ? "SUPER ADMIN" : "ADMIN"}</b><button onClick={() => signOut(auth)}>Déconnexion</button></div>
    </header>
    <div className="admin-heading"><div><span className="eyebrow">TABLEAU DE BORD</span><h1>Administration</h1><p>Gestion des candidatures de la Masterclass Design.</p></div><button className="admin-refresh" onClick={() => void loadCandidates()}>Actualiser</button></div>
    <nav className="admin-tabs">
      <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Vue générale</button>
      <button className={tab === "candidates" ? "active" : ""} onClick={() => setTab("candidates")}>Candidatures <span>{counts.total}</span></button>
      <button className={tab === "downloads" ? "active" : ""} onClick={() => setTab("downloads")}>Téléchargements</button>
    </nav>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {notice && <p className="admin-notice" role="status">{notice}</p>}
    {tab === "overview" && <>
      <div className="admin-stats">
        <article><small>Total des candidatures</small><strong>{counts.total}</strong></article>
        <article><small>En attente</small><strong>{counts.pending}</strong></article>
        <article><small>Approuvées</small><strong>{counts.approved}</strong></article>
        <article><small>Désapprouvées</small><strong>{counts.rejected}</strong></article>
      </div>
      <div className="admin-panel"><div className="admin-panel-title"><h2>Dernières candidatures</h2><button onClick={() => setTab("candidates")}>Voir tout →</button></div>
        {rows.slice(0,5).map(row => <div className="admin-row" key={row.id}><div><b>{row.fullName || "Sans nom"}</b><small>{row.email || row.phone || "Coordonnées non renseignées"}</small></div><Status status={row.status} /></div>)}
        {!rows.length && <p className="admin-empty">{busy ? "Chargement…" : "Aucune candidature enregistrée pour le moment."}</p>}
      </div>
    </>}
    {tab === "candidates" && <div className="admin-panel"><div className="admin-panel-title"><h2>Toutes les candidatures</h2><span>{counts.total} dossier(s)</span></div>
      {rows.map(row => <article className="candidate-card" key={row.id}>
        <div className="candidate-main">{(row.profilePhotoUrl || row.photoUrl) && <img src={row.profilePhotoUrl || row.photoUrl} alt="" />}<div><b>{row.fullName || "Sans nom"}</b><small>{row.extension || "Extension non précisée"} · {row.department || "Département non précisé"}</small><small>{row.phone || ""} {row.email ? "· " + row.email : ""}</small></div><Status status={row.status} /></div>
        <div className="candidate-actions"><button onClick={() => openEdit(row)}>Modifier les infos</button><button onClick={() => void changeStatus(row,"approved")}>Approuver</button><button className="danger" onClick={() => void changeStatus(row,"rejected")}>Désapprouver</button></div>
      </article>)}
      {!rows.length && <p className="admin-empty">{busy ? "Chargement…" : "Aucune candidature enregistrée. La collection attend les premières inscriptions."}</p>}
    </div>}
    {tab === "downloads" && <div className="admin-panel"><div className="admin-panel-title"><h2>Espace de téléchargement</h2><span>Exports et pièces jointes</span></div>
      <div className="download-grid"><article><b>Liste des candidatures</b><p>Exporter les données des candidats au format CSV, compatible avec Excel.</p><button onClick={() => downloadCsv(rows)} disabled={!rows.length}>Télécharger le fichier CSV</button></article><article><b>Version imprimable</b><p>Préparer un rapport PDF depuis la fonction d’impression du navigateur.</p><button onClick={() => window.print()} disabled={!rows.length}>Imprimer / Enregistrer en PDF</button></article></div>
      <h3 className="download-subtitle">Photos et créations envoyées</h3>
      {assets.map((asset,i) => <a className="asset-row" href={asset.url} target="_blank" rel="noreferrer" key={asset.url + i}><span><b>{asset.name}</b><small>{asset.label}</small></span><strong>Ouvrir le fichier ↗</strong></a>)}
      {!assets.length && <p className="admin-empty">Aucun fichier disponible. Les liens apparaîtront lorsque les candidatures et les fichiers Cloudinary seront connectés.</p>}
    </div>}
    {selected && <div className="admin-modal-backdrop" role="presentation"><form className="admin-edit-modal" onSubmit={e => { e.preventDefault(); void saveEdit(); }}><h2>Modifier le dossier</h2><label>Nom complet<input value={edit.fullName} onChange={e => setEdit(v => ({...v,fullName:e.target.value}))} /></label><label>Téléphone<input value={edit.phone} onChange={e => setEdit(v => ({...v,phone:e.target.value}))} /></label><label>E-mail<input value={edit.email} onChange={e => setEdit(v => ({...v,email:e.target.value}))} /></label><label>Commune / quartier<input value={edit.area} onChange={e => setEdit(v => ({...v,area:e.target.value}))} /></label><div><button type="button" onClick={() => setSelected(null)}>Annuler</button><button className="primary" type="submit">Enregistrer</button></div></form></div>}
  </section>;
}

function Status({ status }: { status?: string }) {
  const value = status === "approved" ? "Approuvée" : status === "rejected" ? "Désapprouvée" : "En attente";
  return <span className={"candidate-status " + (status || "pending")}>{value}</span>;
}

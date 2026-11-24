import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

type Role = "superAdmin" | "admin";
type Status = "received" | "review" | "accepted" | "waiting" | "refused";
type Candidate = Record<string, any> & { id: string; fullName?: string; name?: string; email?: string; phone?: string; status?: string };
type Tab = "overview" | "candidates" | "downloads" | "admins";
type AdminRecord = {id:string;firstName?:string;lastName?:string;email?:string;role?:Role;active?:boolean;createdAt?:any};
const statusOptions: { value: Status; label: string }[] = [
  { value: "received", label: "Reçue" }, { value: "review", label: "En étude" },
  { value: "accepted", label: "Acceptée" }, { value: "waiting", label: "Liste d’attente" },
  { value: "refused", label: "Refusée" },
];
const statusOf = (value?: string): Status => {
  if (value === "approved" || value === "accepted") return "accepted";
  if (value === "rejected" || value === "refused") return "refused";
  if (value === "review" || value === "under_review") return "review";
  if (value === "waiting" || value === "waitlist") return "waiting";
  return "received";
};
const personName = (row: Candidate) => row.fullName || row.name || "Sans nom";
const dateLabel = (value: any) => value?.toDate ? value.toDate().toLocaleDateString("fr-FR") : value ? new Date(value).toLocaleDateString("fr-FR") : "—";
const valueOf = (row: Candidate, ...keys: string[]) => keys.map(key => row[key]).find(value => value !== undefined && value !== null && value !== "") ?? "—";

function csvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}
function downloadCsv(rows: Candidate[]) {
  const fields = ["fullName","name","phone","email","area","age","attendance","extension","assembly","department","level","tools","portfolio","ram","availability","motivation","commitment","status"];
  const csv = [fields.join(","), ...rows.map(row => fields.map(field => csvCell(row[field])).join(","))].join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "la-compassion-design-candidatures.csv"; anchor.click();
  URL.revokeObjectURL(url);
}
function Icon({ name }: { name: "grid" | "people" | "download" | "search" | "filter" | "refresh" | "logout" | "chevron" | "close" | "edit" | "check" | "clock" | "file" }) {
  const paths: Record<string,string> = {
    grid:"M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
    people:"M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m6-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm6-7a4 4 0 0 1 0 8m2 3a4 4 0 0 1 4 4v2",
    download:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3",
    search:"m21 21-4.3-4.3M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z",
    filter:"M4 5h16M7 12h10m-7 7h4",
    refresh:"M20 7v5h-5M4 17v-5h5m-3.5-3A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-1",
    logout:"M10 17l5-5-5-5m5 5H3m12-9h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4",
    chevron:"m9 18 6-6-6-6", close:"M18 6 6 18M6 6l12 12", edit:"M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z",
    check:"m5 12 4 4L19 6", clock:"M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-16v6l4 2",
    file:"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8M8 17h8"
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
function StatusPill({ value }: { value?: string }) {
  const status = statusOf(value), label = statusOptions.find(item => item.value === status)!.label;
  return <span className={"admin-status status-" + status}>{label}</span>;
}

export default function AdminPanel({ onHome }: { onHome: () => void }) {
  const [user,setUser] = useState<User|null>(null);
  const [role,setRole] = useState<Role|null>(null);
  const [email,setEmail] = useState(""), [password,setPassword] = useState("");
  const [error,setError] = useState(""), [busy,setBusy] = useState(false);
  const [tab,setTab] = useState<Tab>("overview");
  const [sidebarCollapsed,setSidebarCollapsed] = useState(false);
  const [currentPage,setCurrentPage] = useState(1);
  const pageSize = 15;
  const [rows,setRows] = useState<Candidate[]>([]);
  const [query,setQuery] = useState(""), [filterStatus,setFilterStatus] = useState("all"), [filterLevel,setFilterLevel] = useState("all"), [filterAssembly,setFilterAssembly] = useState("all"), [filterRam,setFilterRam] = useState("all");
  const [selected,setSelected] = useState<Candidate|null>(null);
  const [edit,setEdit] = useState({ fullName:"", phone:"", email:"", area:"", assembly:"", level:"", ram:"" });
  const [newStatus,setNewStatus] = useState<Status>("received");
  const [editOpen,setEditOpen] = useState(false);
  const [previewAsset,setPreviewAsset] = useState<{name:string;label:string;url:string}|null>(null);
  const [previewZoom,setPreviewZoom] = useState(1);
  const [admins,setAdmins] = useState<AdminRecord[]>([]);
  const [adminModalOpen,setAdminModalOpen] = useState(false);
  const [adminForm,setAdminForm] = useState({firstName:"",lastName:"",email:"",password:""});
  const [adminSaving,setAdminSaving] = useState(false);

  useEffect(() => onAuthStateChanged(auth, async current => {
    setUser(current); setRole(null);
    if (!current) return;
    try {
      const adminDoc = await getDoc(doc(db,"admins",current.uid)), data = adminDoc.data();
      if (adminDoc.exists() && data?.active === true && (data?.role === "admin" || data?.role === "superAdmin")) setRole(data.role);
      else { setError("Ce compte n’est pas autorisé à accéder à cet espace."); await signOut(auth); }
    } catch { setError("Vérification des droits impossible. Contrôle les règles Firestore."); await signOut(auth); }
  }),[]);
  const loadAdmins = async () => {
    if (role !== "superAdmin") return;
    try {
      const snapshot = await getDocs(collection(db, "admins"));
      setAdmins(snapshot.docs.map(item => ({ id: item.id, ...item.data() })) as AdminRecord[]);
    } catch {
      setError("Impossible de charger les administrateurs. Vérifie les règles Firestore.");
    }
  };
  const loadCandidates = async () => {
    setBusy(true); setError("");
    try {
      const snapshot = await getDocs(collection(db,"candidatures"));
      const items = snapshot.docs.map(item => ({id:item.id,...item.data()})) as Candidate[];
      items.sort((a,b) => {
        const time = (v:any) => v?.toMillis?.() ?? (v ? new Date(v).getTime() : 0);
        return time(b.createdAt)-time(a.createdAt);
      });
      setRows(items);
    } catch { setError("Impossible de lire les candidatures. Vérifie la collection « candidatures » et ses règles d’accès."); }
    finally { setBusy(false); }
  };
  useEffect(() => { if(user && role) void loadCandidates(); if(user && role==="superAdmin") void loadAdmins(); },[user,role]);
  const counts = useMemo(() => ({
    total:rows.length, accepted:rows.filter(r=>statusOf(r.status)==="accepted").length,
    pending:rows.filter(r=>["received","review"].includes(statusOf(r.status))).length,
    waiting:rows.filter(r=>statusOf(r.status)==="waiting").length,
  }),[rows]);
  const filtered = useMemo(() => rows.filter(row => {
    const haystack = [personName(row),row.phone,row.email,row.assembly,row.extension].join(" ").toLowerCase();
    return (!query || haystack.includes(query.toLowerCase()))
      && (filterStatus==="all" || statusOf(row.status)===filterStatus)
      && (filterLevel==="all" || valueOf(row,"level")===filterLevel)
      && (filterAssembly==="all" || valueOf(row,"assembly","extension")===filterAssembly)
      && (filterRam==="all" || valueOf(row,"ram")===filterRam);
  }),[rows,query,filterStatus,filterLevel,filterAssembly,filterRam]);
  useEffect(() => { setCurrentPage(1); }, [query,filterStatus,filterLevel,filterAssembly,filterRam]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const login = async (event:React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await signInWithEmailAndPassword(auth,email.trim(),password); setPassword(""); }
    catch { setError("Connexion impossible. Vérifie ton adresse e-mail et ton mot de passe."); }
    finally { setBusy(false); }
  };
  const changeStatus = async (candidate:Candidate,status:Status) => {
    try {
      await updateDoc(doc(db,"candidatures",candidate.id),{status,reviewedAt:new Date(),reviewedBy:user?.uid??null});
      setRows(prev=>prev.map(row=>row.id===candidate.id?{...row,status}:row));
      setSelected(prev=>prev?.id===candidate.id?{...prev,status}:prev);
    } catch { setError("Modification refusée. Les règles Firestore doivent autoriser cette action."); }
  };
  const createAdmin = async (event:React.FormEvent) => {
    event.preventDefault();
    if(role!=="superAdmin" || !user) return;
    const firstName=adminForm.firstName.trim(), lastName=adminForm.lastName.trim(), adminEmail=adminForm.email.trim().toLowerCase();
    if(!firstName || !lastName || !adminEmail || adminForm.password.length<8){setError("Renseigne tous les champs. Le mot de passe doit contenir au moins 8 caractères.");return;}
    setAdminSaving(true);setError("");
    let secondaryUser:User|null=null;
    let secondaryApp:ReturnType<typeof initializeApp>|null=null;
    try {
      secondaryApp=initializeApp(firebaseApp.options,"compassion-admin-creator");
      const secondaryAuth=getAuth(secondaryApp);
      const credential=await createUserWithEmailAndPassword(secondaryAuth,adminEmail,adminForm.password);
      secondaryUser=credential.user;
      await setDoc(doc(db,"admins",credential.user.uid),{firstName,lastName,email:adminEmail,role:"admin",active:true,createdAt:serverTimestamp(),createdBy:user.uid});
      setAdminForm({firstName:"",lastName:"",email:"",password:""});
      setAdminModalOpen(false);
      await loadAdmins();
    } catch (err:any) {
      if(secondaryUser){try{await deleteUser(secondaryUser);}catch{/* Le compte peut nécessiter un nettoyage manuel dans Firebase Auth. */}}
      const code=err?.code;
      setError(code==="auth/email-already-in-use"?"Cette adresse e-mail possède déjà un compte.":code==="auth/weak-password"?"Le mot de passe doit contenir au moins 8 caractères.":code==="auth/invalid-email"?"L'adresse e-mail est invalide.":"Création impossible. Vérifie Authentication et les règles Firestore de la collection admins.");
    } finally {
      if(secondaryApp){try{await deleteApp(secondaryApp);}catch{/* Nettoyage de l'application secondaire. */}}
      setAdminSaving(false);
    }
  };
  const openDetails = (row:Candidate) => { setSelected(row); setNewStatus(statusOf(row.status)); };
  const openEdit = (row:Candidate) => {
    setSelected(row); setNewStatus(statusOf(row.status));
    setEdit({fullName:personName(row)==="Sans nom"?"":personName(row),phone:row.phone??"",email:row.email??"",area:row.area??row.commune??"",assembly:row.assembly??row.extension??"",level:row.level??"",ram:row.ram??""});
  };
  const saveEdit = async () => {
    if(!selected) return;
    const patch = {fullName:edit.fullName,phone:edit.phone,email:edit.email,area:edit.area,assembly:edit.assembly,level:edit.level,ram:edit.ram};
    try {
      await updateDoc(doc(db,"candidatures",selected.id),patch);
      setRows(prev=>prev.map(row=>row.id===selected.id?{...row,...patch}:row));
      setEditOpen(false); setSelected(null);
    } catch { setError("Modification impossible. Vérifie les autorisations Firestore."); }
  };
  const assets = rows.flatMap(row => [
    row.profilePhotoUrl||row.photoUrl ? {name:personName(row),label:"Photo de profil",url:row.profilePhotoUrl||row.photoUrl}:null,
    row.portfolioFileUrl||row.portfolioUrl ? {name:personName(row),label:"Création / portfolio",url:row.portfolioFileUrl||row.portfolioUrl}:null
  ].filter(Boolean) as {name:string;label:string;url:string}[]);

  if(!user || !role) return <section className="admin-login-page">
    <button className="admin-back-home" onClick={onHome}>← Retour à l’accueil</button>
    <form className="admin-login" onSubmit={login}>
      <div className="admin-brand"><span className="admin-brand-symbol">C</span><span>LA COMPASSION <b>DESIGN</b></span></div>
      <span className="admin-kicker">ACCÈS SÉCURISÉ</span><h1>Espace administration</h1>
      <p>Connecte-toi avec les identifiants qui t’ont été attribués.</p>
      <label>Adresse e-mail<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required /></label>
      <label>Mot de passe<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required /></label>
      {error&&<p className="admin-error" role="alert">{error}</p>}
      <button className="admin-primary" disabled={busy}>{busy?"Connexion…":"Se connecter"}</button>
    </form>
  </section>;

  return <section className={"admin-app" + (sidebarCollapsed ? " sidebar-collapsed" : "")}>
    <aside className="admin-sidebar">
      <div className="admin-sidebar-top"><div className="admin-brand"><span className="admin-brand-symbol">C</span><span className="admin-brand-name">LA COMPASSION <b>DESIGN</b></span></div><button className="admin-collapse" type="button" onClick={()=>setSidebarCollapsed(value=>!value)} aria-label={sidebarCollapsed?"Déplier le menu":"Replier le menu"} title={sidebarCollapsed?"Déplier le menu":"Replier le menu"}><Icon name="chevron"/></button></div>
      <div className="admin-sidebar-label">ESPACE DE TRAVAIL</div>
      <button className={tab==="overview"?"selected":""} onClick={()=>setTab("overview")} title="Vue générale"><Icon name="grid"/><span>Vue générale</span></button>
      <button className={tab==="candidates"?"selected":""} onClick={()=>setTab("candidates")} title="Candidatures"><Icon name="people"/><span>Candidatures</span><span className="admin-nav-count">{rows.length}</span></button>
      <button className={tab==="downloads"?"selected":""} onClick={()=>setTab("downloads")} title="Téléchargements"><Icon name="download"/><span>Téléchargements</span></button>
      {role==="superAdmin"&&<button className={tab==="admins"?"selected":""} onClick={()=>setTab("admins")} title="Gestion des administrateurs"><Icon name="people"/><span>Administrateurs</span><span className="admin-nav-count">{admins.length}</span></button>}
      <div className="admin-sidebar-bottom"><span className="admin-role-mark">{role==="superAdmin"?"SA":"A"}</span><div className="admin-user-meta"><b>{user.email}</b><small>{role==="superAdmin"?"Super administrateur":"Administrateur"}</small></div><button aria-label="Déconnexion" title="Déconnexion" onClick={()=>signOut(auth)}><Icon name="logout"/></button></div>
    </aside>
    <main className="admin-main">
      <header className="admin-mobile-head"><div className="admin-brand"><span className="admin-brand-symbol">C</span><span>LA COMPASSION <b>DESIGN</b></span></div><button onClick={()=>signOut(auth)} aria-label="Déconnexion"><Icon name="logout"/></button></header>
      <div className="admin-page-head"><div><span className="admin-kicker">MASTERCLASS DESIGN · 15—19 DÉCEMBRE 2026</span><h1>{tab==="overview"?"Vue générale":tab==="candidates"?"Candidatures":tab==="downloads"?"Téléchargements":"Gestion des administrateurs"}</h1><p>{tab==="admins"?"Création et suivi des accès administrateurs.":"Suivi et gestion des dossiers de candidature."}</p></div><button className="admin-refresh" onClick={()=>void loadCandidates()} disabled={busy}><Icon name="refresh"/>{busy?"Actualisation…":"Actualiser"}</button></div>
      {error&&<p className="admin-error" role="alert">{error}</p>}
      {tab==="overview"&&<>
        <div className="admin-summary">
          <article><span>Total des dossiers</span><strong>{counts.total}</strong><small>Toutes les candidatures reçues</small></article>
          <article><span>À traiter</span><strong>{counts.pending}</strong><small>Reçues ou en étude</small></article>
          <article><span>Acceptées</span><strong>{counts.accepted}</strong><small>Candidatures retenues</small></article>
          <article><span>Liste d’attente</span><strong>{counts.waiting}</strong><small>Dossiers en attente</small></article>
        </div>
        <section className="admin-section"><div className="admin-section-head"><div><h2>Dossiers récents</h2><p>Les dernières candidatures enregistrées.</p></div><button className="admin-text-action" onClick={()=>setTab("candidates")}>Toutes les candidatures <Icon name="chevron"/></button></div>
          <CandidateTable rows={rows.slice(0,6)} onOpen={openDetails} startNumber={0}/>
          {!rows.length&&<p className="admin-empty">{busy?"Chargement des dossiers…":"Aucune candidature enregistrée pour le moment."}</p>}
        </section>
      </>}
      {tab==="candidates"&&<>
        <section className="admin-toolbar">
          <div className="admin-search"><Icon name="search"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Rechercher un nom ou un téléphone…" aria-label="Rechercher un candidat"/></div>
          <div className="admin-filters"><label><Icon name="filter"/><select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}><option value="all">Tous les statuts</option>{statusOptions.map(s=><option value={s.value} key={s.value}>{s.label}</option>)}</select></label>
            <select value={filterLevel} onChange={e=>setFilterLevel(e.target.value)}><option value="all">Tous les niveaux</option>{["Débutant","Intermédiaire","Avancé"].map(x=><option key={x}>{x}</option>)}</select>
            <select value={filterAssembly} onChange={e=>setFilterAssembly(e.target.value)}><option value="all">Toutes les assemblées</option>{Array.from(new Set(rows.map(r=>String(valueOf(r,"assembly","extension"))).filter(v=>v!=="—"))).map(x=><option key={x}>{x}</option>)}</select>
            <select value={filterRam} onChange={e=>setFilterRam(e.target.value)}><option value="all">Compatibilité PC</option>{["Oui","Non","Je ne sais pas"].map(x=><option key={x}>{x}</option>)}</select>
          </div>
        </section>
        <section className="admin-section"><div className="admin-section-head"><div><h2>Liste des inscrits</h2><p>{filtered.length} dossier(s) correspondant aux filtres.</p></div></div>
          <CandidateTable rows={pageRows} onOpen={openDetails} startNumber={(currentPage - 1) * pageSize}/>
          {filtered.length > pageSize && <nav className="admin-pagination" aria-label="Pagination des candidatures"><span>Page {currentPage} sur {pageCount} · {filtered.length} dossiers</span><div><button type="button" disabled={currentPage===1} onClick={()=>setCurrentPage(p=>Math.max(1,p-1))}>Précédent</button>{Array.from({length:pageCount},(_,i)=>i+1).map(page=><button type="button" key={page} className={page===currentPage?"active":""} onClick={()=>setCurrentPage(page)}>{page}</button>)}<button type="button" disabled={currentPage===pageCount} onClick={()=>setCurrentPage(p=>Math.min(pageCount,p+1))}>Suivant</button></div></nav>}
          {!filtered.length&&<p className="admin-empty">{busy?"Chargement…":"Aucun dossier ne correspond à cette recherche."}</p>}
        </section>
      </>}
      {tab==="downloads"&&<section className="admin-section admin-downloads">
        <div className="admin-section-head"><div><h2>Exporter les candidatures</h2><p>Les filtres actifs de la liste sont appliqués à l’export.</p></div></div>
        <div className="admin-export-row"><div className="admin-export-icon"><Icon name="file"/></div><div><b>Fichier CSV / Excel</b><p>Nom, téléphone, assemblée, niveau, RAM, statut et réponses du formulaire.</p></div><button className="admin-primary" disabled={!filtered.length} onClick={()=>downloadCsv(filtered)}><Icon name="download"/>Télécharger CSV</button></div>
        <div className="admin-export-row"><div className="admin-export-icon"><Icon name="file"/></div><div><b>Rapport imprimable</b><p>Ouvre la boîte d’impression pour enregistrer la liste filtrée en PDF.</p></div><button className="admin-secondary" disabled={!filtered.length} onClick={()=>window.print()}>Imprimer / PDF</button></div>
        <div className="admin-section-head admin-assets-head"><div><h2>Pièces jointes</h2><p>Photos de profil et créations transmises par les candidats.</p></div></div>
        {assets.map((asset,i)=><button type="button" className="admin-asset" onClick={()=>setPreviewAsset(asset)} key={asset.url+i}><span><b>{asset.name}</b><small>{asset.label}</small></span><strong>Afficher la pièce</strong></button>)}
        {!assets.length&&<p className="admin-empty">Aucun fichier n’est encore associé aux candidatures.</p>}
      </section>}
      {tab==="admins"&&role==="superAdmin"&&<section className="admin-section admin-manage-admins">
        <div className="admin-section-head"><div><h2>Équipe d’administration</h2><p>Seul le super administrateur peut créer de nouveaux comptes.</p></div><button className="admin-primary" onClick={()=>{setError("");setAdminModalOpen(true)}}>＋ Créer un administrateur</button></div>
        <div className="admin-admin-list">{admins.map(item=><article className="admin-admin-row" key={item.id}><span className="admin-admin-avatar">{(item.firstName||item.email||"A").slice(0,1).toUpperCase()}</span><div className="admin-admin-info"><b>{[item.firstName,item.lastName].filter(Boolean).join(" ")||"Administrateur"}</b><small>{item.email||"—"}</small></div><span className={"admin-role-pill "+(item.role==="superAdmin"?"super":"")}>{item.role==="superAdmin"?"Super administrateur":"Administrateur"}</span><span className={"admin-active-pill "+(item.active?"active":"")}>{item.active?"Actif":"Désactivé"}</span></article>)}</div>
        {!admins.length&&<p className="admin-empty">Aucun administrateur trouvé.</p>}
      </section>}
    </main>
    {adminModalOpen&&role==="superAdmin"&&<div className="admin-edit-overlay" onClick={()=>!adminSaving&&setAdminModalOpen(false)}>
      <form className="admin-edit-card admin-create-admin-modal" onSubmit={createAdmin} onClick={e=>e.stopPropagation()}>
        <div className="admin-drawer-head"><div><span className="admin-kicker">ACCÈS ET AUTORISATIONS</span><h2>Créer un administrateur</h2></div><button type="button" onClick={()=>setAdminModalOpen(false)} disabled={adminSaving} aria-label="Fermer"><Icon name="close"/></button></div>
        <p className="admin-modal-description">Ce compte aura accès aux candidatures et aux téléchargements, sans les droits du super administrateur.</p>
        <div className="admin-form-grid"><label>Prénom<input autoFocus value={adminForm.firstName} onChange={e=>setAdminForm(v=>({...v,firstName:e.target.value}))} required maxLength={60}/></label><label>Nom<input value={adminForm.lastName} onChange={e=>setAdminForm(v=>({...v,lastName:e.target.value}))} required maxLength={60}/></label></div>
        <label>Adresse e-mail<input type="email" autoComplete="off" value={adminForm.email} onChange={e=>setAdminForm(v=>({...v,email:e.target.value}))} required/></label>
        <label>Mot de passe temporaire<input type="password" autoComplete="new-password" minLength={8} value={adminForm.password} onChange={e=>setAdminForm(v=>({...v,password:e.target.value}))} required/><small>8 caractères minimum. Communique-le de manière sécurisée à la personne.</small></label>
        {error&&<p className="admin-error" role="alert">{error}</p>}
        <div className="admin-create-modal-actions"><button type="button" className="admin-secondary" disabled={adminSaving} onClick={()=>setAdminModalOpen(false)}>Annuler</button><button className="admin-primary" type="submit" disabled={adminSaving}>{adminSaving?"Création…":"Créer le compte"}</button></div>
      </form>
    </div>}
    {previewAsset&&<div className="admin-preview-overlay" onClick={()=>setPreviewAsset(null)}>
      <section className="admin-preview" role="dialog" aria-modal="true" aria-label="Aperçu de la pièce jointe" onClick={e=>e.stopPropagation()}>
        <header className="admin-preview-head"><div><b>{previewAsset.name}</b><small>{previewAsset.label}</small></div><div className="admin-preview-actions">{(previewAsset.label.toLowerCase().includes("photo") || previewAsset.url.includes("/image/upload/") || [".jpg",".jpeg",".png",".webp",".gif"].some(ext=>previewAsset.url.toLowerCase().includes(ext))) && <><button type="button" onClick={()=>setPreviewZoom(z=>Math.max(.25,Number((z-.25).toFixed(2))))} disabled={previewZoom<=.25} aria-label="Dézoomer" title="Dézoomer">−</button><span>{Math.round(previewZoom*100)}%</span><button type="button" onClick={()=>setPreviewZoom(z=>Math.min(4,Number((z+.25).toFixed(2))))} disabled={previewZoom>=4} aria-label="Zoomer" title="Zoomer">+</button><button type="button" onClick={()=>setPreviewZoom(1)} title="Taille réelle">100 %</button></>}<button type="button" onClick={()=>setPreviewAsset(null)} aria-label="Fermer l’aperçu" title="Fermer"><Icon name="close"/></button></div></header>
        <div className="admin-preview-content">{(previewAsset.label.toLowerCase().includes("photo") || previewAsset.url.includes("/image/upload/") || [".jpg",".jpeg",".png",".webp",".gif"].some(ext=>previewAsset.url.toLowerCase().includes(ext))) ? <img style={{transform:`scale(${previewZoom})`}} src={previewAsset.url} alt={previewAsset.label}/> : <iframe src={previewAsset.url} title={previewAsset.label}/>}</div>
      </section>
    </div>}
    {selected&&<div className="admin-drawer-backdrop" onClick={()=>setSelected(null)}>
      <aside className="admin-drawer" onClick={e=>e.stopPropagation()}>
        <div className="admin-drawer-head"><div className="admin-profile-heading">{(selected.profilePhotoUrl||selected.photoUrl) ? <button type="button" className="admin-profile-photo-trigger" onClick={()=>{setPreviewZoom(1);setPreviewAsset({name:personName(selected),label:"Photo de profil",url:selected.profilePhotoUrl||selected.photoUrl||""})}} aria-label="Agrandir la photo de profil"><img className="admin-profile-photo" src={selected.profilePhotoUrl||selected.photoUrl} alt={"Photo de "+personName(selected)}/></button> : <div className="admin-profile-placeholder">{personName(selected).slice(0,1).toUpperCase()}</div>}<div><span className="admin-kicker">FICHE CANDIDAT</span><h2>{personName(selected)}</h2><small>{valueOf(selected,"phone")}</small></div></div><button onClick={()=>setSelected(null)} aria-label="Fermer"><Icon name="close"/></button></div>
        <StatusPill value={selected.status}/>
        <div className="admin-detail-list">
          {[
            ["Téléphone",valueOf(selected,"phone")],["E-mail",valueOf(selected,"email")],["Commune / quartier",valueOf(selected,"area","commune")],
            ["Assemblée",valueOf(selected,"assembly","extension")],["Département",valueOf(selected,"department")],["Niveau design",valueOf(selected,"level")],
            ["Ordinateur · RAM",valueOf(selected,"ram")],["Disponibilité",valueOf(selected,"availability")],["Outils",valueOf(selected,"tools")],
            ["Date de candidature",dateLabel(selected.createdAt)]
          ].map(([label,value])=><div key={label}><small>{label}</small><b>{Array.isArray(value)?value.join(", "):String(value)}</b></div>)}
        </div>
        {selected.portfolioFileUrl||selected.portfolioUrl?<button type="button" className="admin-file-link" onClick={()=>{setPreviewZoom(1);setPreviewAsset({name:personName(selected),label:"Création jointe",url:selected.portfolioFileUrl||selected.portfolioUrl||""})}}>Consulter la création jointe</button>:null}
        <label className="admin-status-select">Décision sur le dossier<select value={newStatus} onChange={e=>setNewStatus(e.target.value as Status)}>{statusOptions.map(s=><option value={s.value} key={s.value}>{s.label}</option>)}</select></label>
        <button className="admin-primary admin-full" onClick={()=>void changeStatus(selected,newStatus)}>Enregistrer le statut</button>
        {role==="superAdmin"&&<button className="admin-secondary admin-full" onClick={()=>openEdit(selected)}><Icon name="edit"/> Modifier les informations</button>}
        {role!=="superAdmin"&&<p className="admin-permission-note">La modification des informations personnelles est réservée au super administrateur.</p>}
      </aside>
    </div>}
    {selected&&role==="superAdmin"&&editOpen&&<div className="admin-edit-overlay"><form className="admin-edit-card" onSubmit={e=>{e.preventDefault();void saveEdit();}}><div className="admin-drawer-head"><h2>Modifier le dossier</h2><button type="button" onClick={()=>setEditOpen(false)} aria-label="Fermer"><Icon name="close"/></button></div>
      {(["fullName","phone","email","area","assembly","level","ram"] as const).map(key=><label key={key}>{({fullName:"Nom complet",phone:"Téléphone",email:"E-mail",area:"Commune / quartier",assembly:"Assemblée",level:"Niveau design",ram:"Compatibilité PC"} as Record<string,string>)[key]}<input value={edit[key]} onChange={e=>setEdit(v=>({...v,[key]:e.target.value}))}/></label>)}
      <button className="admin-primary admin-full" type="submit">Enregistrer les modifications</button>
    </form></div>}
  </section>;
}
function CandidateTable({rows,onOpen,startNumber=0}:{rows:Candidate[];onOpen:(row:Candidate)=>void;startNumber?:number}) {
  return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>N°</th><th>Candidat</th><th>Assemblée</th><th>Niveau</th><th>RAM</th><th>Statut</th><th>Date</th><th></th></tr></thead><tbody>{rows.map((row,index)=><tr key={row.id} onClick={()=>onOpen(row)}><td className="admin-row-number">{startNumber + index + 1}</td><td><b>{personName(row)}</b><small>{row.phone||row.email||"—"}</small></td><td>{valueOf(row,"assembly","extension")}</td><td>{valueOf(row,"level")}</td><td>{valueOf(row,"ram")}</td><td><StatusPill value={row.status}/></td><td>{dateLabel(row.createdAt)}</td><td><button aria-label={"Ouvrir le dossier de "+personName(row)}><Icon name="chevron"/></button></td></tr>)}</tbody></table>
    <div className="admin-mobile-list">{rows.map((row,index)=><button className="admin-mobile-candidate" key={row.id} onClick={()=>onOpen(row)}><span className="admin-mobile-number">{startNumber + index + 1}</span><span><b>{personName(row)}</b><small>{valueOf(row,"assembly","extension")} · {valueOf(row,"level")}</small><small>{row.phone||row.email||"—"}</small></span><span><StatusPill value={row.status}/><Icon name="chevron"/></span></button>)}</div>
  </div>;
}

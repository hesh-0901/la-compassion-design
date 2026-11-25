import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { arrayUnion, collection, doc, getDoc, getDocs, serverTimestamp, updateDoc } from "firebase/firestore";
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

function xmlEscape(value: unknown) {
  return String(value ?? "").replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]/g,"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
function excelColumn(index:number){
  let n=index+1, name="";
  while(n){const rem=(n-1)%26;name=String.fromCharCode(65+rem)+name;n=Math.floor((n-1)/26);}
  return name;
}
function crc32(bytes:Uint8Array){
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function zipStore(files:{name:string;content:string}[]){
  const encoder=new TextEncoder(), local:Uint8Array[]=[], central:Uint8Array[]=[];
  let offset=0;
  const u16=(v:number)=>[v&255,(v>>>8)&255],u32=(v:number)=>[v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255];
  for(const file of files){
    const name=encoder.encode(file.name),data=encoder.encode(file.content),crc=crc32(data);
    const header=new Uint8Array([...u32(0x04034b50),...u16(20),...u16(0x0800),...u16(0),...u16(33),...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0),...name]);
    local.push(header,data);
    const entry=new Uint8Array([...u32(0x02014b50),...u16(20),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset),...name]);
    central.push(entry);offset+=header.length+data.length;
  }
  const centralSize=central.reduce((sum,item)=>sum+item.length,0);
  const end=new Uint8Array([...u32(0x06054b50),...u16(0),...u16(0),...u16(files.length),...u16(files.length),...u32(centralSize),...u32(offset),...u16(0)]);
  return new Blob([...local,...central,end],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}
function downloadXlsx(rows:Candidate[]){
  const columns:[string,(row:Candidate)=>unknown][]=[
    ["Nom complet",r=>valueOf(r,"fullName","name")],["Genre",r=>valueOf(r,"gender")],["Téléphone",r=>valueOf(r,"phone")],["E-mail",r=>valueOf(r,"email")],
    ["Commune / quartier",r=>valueOf(r,"area","commune")],["Tranche d’âge",r=>valueOf(r,"age")],["Membre de l’Église",r=>valueOf(r,"member")],
    ["Ancienneté / présence",r=>valueOf(r,"attendance")],["Assemblée / extension",r=>valueOf(r,"assembly","extension")],["Département",r=>valueOf(r,"department")],
    ["Maturité spirituelle",r=>valueOf(r,"maturity")],["Niveau design",r=>valueOf(r,"level")],["Outils",r=>valueOf(r,"tools")],
    ["Lien portfolio",r=>valueOf(r,"portfolio")],["Fichier portfolio",r=>valueOf(r,"portfolioFileUrl","portfolioUrl")],["Photo de profil",r=>valueOf(r,"profilePhotoUrl","photoUrl")],
    ["Ordinateur / RAM",r=>valueOf(r,"ram")],["Disponibilité",r=>valueOf(r,"availability")],["Motivation",r=>valueOf(r,"motivation")],
    ["Engagement département Design",r=>valueOf(r,"commitment")],["Statut",r=>statusOptions.find(s=>s.value===statusOf(r.status))?.label??"Reçue"],
    ["Date de candidature",r=>dateLabel(r.createdAt)]
  ];
  const all=[columns.map(c=>c[0]),...rows.map(row=>columns.map(([,get])=>{const v=get(row);return Array.isArray(v)?v.join(", "):v instanceof Date?v.toLocaleString("fr-FR"):String(v??"");}))];
  const sheetRows=all.map((line,ri)=>'<row r="'+(ri+1)+'">'+line.map((value,ci)=>'<c r="'+excelColumn(ci)+(ri+1)+'" t="inlineStr"><is><t xml:space="preserve">'+xmlEscape(value)+'</t></is></c>').join("")+'</row>').join("");
  const last=excelColumn(columns.length-1);
  const files=[
    {name:"[Content_Types].xml",content:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'},
    {name:"_rels/.rels",content:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
    {name:"xl/workbook.xml",content:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Candidatures" sheetId="1" r:id="rId1"/></sheets></workbook>'},
    {name:"xl/_rels/workbook.xml.rels",content:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'},
    {name:"xl/worksheets/sheet1.xml",content:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:'+last+all.length+'"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><sheetData>'+sheetRows+'</sheetData><autoFilter ref="A1:'+last+all.length+'"/></worksheet>'}
  ];
  const blob=zipStore(files),url=URL.createObjectURL(blob),anchor=document.createElement("a");
  anchor.href=url;anchor.download="la-compassion-design-candidatures.xlsx";anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
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
  const icons:Record<Status,string>={received:"M5 12h14",review:"M12 3v18m-9-9h18",accepted:"m5 12 4 4L19 6",waiting:"M12 8v4l3 2",refused:"M18 6 6 18M6 6l12 12"};
  return <span className={"admin-status status-" + status}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={icons[status]}/></svg>{label}</span>;
}

export default function AdminPanel({ onHome }: { onHome: () => void }) {
  const [user,setUser] = useState<User|null>(null);
  const [role,setRole] = useState<Role|null>(null);
  const [email,setEmail] = useState(""), [password,setPassword] = useState("");
  const [error,setError] = useState(""), [busy,setBusy] = useState(false);
  const [tab,setTab] = useState<Tab>("overview");
  const [sidebarCollapsed,setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen,setMobileSidebarOpen] = useState(false);
  const [mobileFiltersOpen,setMobileFiltersOpen] = useState(false);
  const [currentPage,setCurrentPage] = useState(1);
  const pageSize = 15;
  const [rows,setRows] = useState<Candidate[]>([]);
  const [attentionFilter,setAttentionFilter] = useState<"all"|"partial"|"ram"|"photo"|"portfolio">("all");
  const [reviewPage,setReviewPage] = useState(1);
  const reviewPageSize=5;
  const [capacity,setCapacity] = useState<number|null>(null);
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
  const [selectedAdmin,setSelectedAdmin] = useState<AdminRecord|null>(null);
  const [adminEditForm,setAdminEditForm] = useState({firstName:"",lastName:"",active:true});
  const [adminEditSaving,setAdminEditSaving] = useState(false);
  const [showAdminPassword,setShowAdminPassword] = useState(false);
  const [internalNote,setInternalNote] = useState("");
  const [noteSaving,setNoteSaving] = useState(false);

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
    if (!role) return;
    try {
      const snapshot = await getDocs(collection(db, "admins"));
      setAdmins(snapshot.docs.map(item => ({ id: item.id, ...item.data() })) as AdminRecord[]);
    } catch {
      setError("Impossible de charger les administrateurs. Vérifie les règles Firestore.");
    }
  };
  const loadCapacity = async () => { try { const snap=await getDoc(doc(db,"configuration","masterclass"));const raw=snap.exists()?snap.data().capacity:null;const value=Number(raw);setCapacity(raw!==null&&raw!==""&&Number.isFinite(value)&&value>0?value:null); } catch { setCapacity(null); } };
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
  useEffect(() => { if(user && role){void loadCandidates();void loadCapacity();void loadAdmins();} },[user,role]);
  useEffect(() => { const updateSidebar=()=>setSidebarCollapsed(window.innerWidth<=1100);updateSidebar();window.addEventListener("resize",updateSidebar);return ()=>window.removeEventListener("resize",updateSidebar); },[]);
  const counts = useMemo(() => ({
    total:rows.length, received:rows.length,
    accepted:rows.filter(r=>statusOf(r.status)==="accepted").length,
    pending:rows.filter(r=>["received","review"].includes(statusOf(r.status))).length,
    waiting:rows.filter(r=>statusOf(r.status)==="waiting").length,
  }),[rows]);
  const filtered = useMemo(() => rows.filter(row => {
    const normalize=(value:unknown)=>String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
    const rawQuery=normalize(query), phoneQuery=rawQuery.replace(/\D/g,"").replace(/^243/,"");
    const haystack = normalize([personName(row),row.phone,row.email,row.assembly,row.extension].join(" "));
    const candidatePhone=String(row.phone??"").replace(/\D/g,"").replace(/^243/,"");
    return (!rawQuery || haystack.includes(rawQuery) || (phoneQuery && candidatePhone.includes(phoneQuery)))
      && (filterStatus==="all" || statusOf(row.status)===filterStatus)
      && (filterLevel==="all" || valueOf(row,"level")===filterLevel)
      && (filterAssembly==="all" || valueOf(row,"assembly","extension")===filterAssembly)
      && (filterRam==="all" || valueOf(row,"ram")===filterRam)
      && (attentionFilter==="all" || (attentionFilter==="partial" && String(row.availability??"").toLowerCase().includes("partiellement")) || (attentionFilter==="ram" && !["oui","yes","8 go","8gb","8 go ram"].includes(String(row.ram??"").trim().toLowerCase())) || (attentionFilter==="photo" && !String(row.profilePhotoUrl||row.photoUrl||"").trim()) || (attentionFilter==="portfolio" && !String(row.portfolioFileUrl||row.portfolioUrl||row.portfolio||"").trim()));
  }),[rows,query,filterStatus,filterLevel,filterAssembly,filterRam,attentionFilter]);
  useEffect(() => { setCurrentPage(1); }, [query,filterStatus,filterLevel,filterAssembly,filterRam,attentionFilter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const login = async (event:React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await signInWithEmailAndPassword(auth,email.trim(),password); setPassword(""); }
    catch { setError("Connexion impossible. Vérifie ton adresse e-mail et ton mot de passe."); }
    finally { setBusy(false); }
  };
  const changeStatus = async (candidate:Candidate,status:Status) => {
    const previous=statusOf(candidate.status);
    if(previous===status) return;
    if(status==="refused" && !window.confirm("Confirmer le refus définitif de cette candidature ?")) return;
    try {
      const historyEntry={from:String(candidate.status??"received"),to:status,adminId:user?.uid??"",changedAt:new Date()};
      await updateDoc(doc(db,"candidatures",candidate.id),{status,reviewedAt:serverTimestamp(),reviewedBy:user?.uid??null,statusHistory:arrayUnion(historyEntry)});
      const patch={status,reviewedAt:new Date(),reviewedBy:user?.uid??null,statusHistory:[...(candidate.statusHistory??[]),historyEntry]};
      setRows(prev=>prev.map(row=>row.id===candidate.id?{...row,...patch}:row));
      setSelected(prev=>prev?.id===candidate.id?{...prev,...patch}:prev);
      setNewStatus(status); setError("");
    } catch { setError("Modification refusée. Vérifie les règles Firestore et les droits de cet administrateur."); }
  };
  const saveInternalNote = async () => {
    if(!selected) return;
    setNoteSaving(true);
    try {
      await updateDoc(doc(db,"candidatures",selected.id),{internalNote});
      setRows(prev=>prev.map(row=>row.id===selected.id?{...row,internalNote}:row));
      setSelected(prev=>prev?.id===selected.id?{...prev,internalNote}:prev);
    } catch { setError("Impossible d’enregistrer la note interne. Vérifie les règles Firestore."); }
    finally { setNoteSaving(false); }
  };
  const openAdminDetails = (item:AdminRecord) => {
    setSelectedAdmin(item);
    setAdminEditForm({firstName:item.firstName??"",lastName:item.lastName??"",active:item.active===true});
    setError("");
  };
  const saveAdminDetails = async (event:React.FormEvent) => {
    event.preventDefault();
    if(role!=="superAdmin" || !selectedAdmin) return;
    const firstName=adminEditForm.firstName.trim(), lastName=adminEditForm.lastName.trim();
    if(!firstName || !lastName){setError("Le prénom et le nom sont obligatoires.");return;}
    setAdminEditSaving(true);setError("");
    try{
      const patch={firstName,lastName,active:adminEditForm.active};
      await updateDoc(doc(db,"admins",selectedAdmin.id),patch);
      setAdmins(prev=>prev.map(item=>item.id===selectedAdmin.id?{...item,...patch}:item));
      setSelectedAdmin({...selectedAdmin,...patch});
    }catch{
      setError("Modification impossible. Vérifie les règles Firestore de la collection admins.");
    }finally{setAdminEditSaving(false);}
  };

  const createAdmin = async (event:React.FormEvent) => {
    event.preventDefault();
    if(role!=="superAdmin" || !user) return;
    const firstName=adminForm.firstName.trim(), lastName=adminForm.lastName.trim();
    const emailPart=(firstName+lastName).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
    const adminEmail=emailPart+"@design.cmps";
    if(!firstName || !lastName || !emailPart || adminForm.password.length<8){setError("Renseigne le prénom, le nom et un mot de passe de 8 caractères minimum.");return;}
    setAdminSaving(true);setError("");
    try {
      const token=await user.getIdToken();
      const response=await fetch("/api/admin/create",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},body:JSON.stringify({firstName,lastName,email:adminEmail,password:adminForm.password})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(result.error||"Création impossible. Vérifie la configuration serveur.");
      setAdminForm({firstName:"",lastName:"",email:"",password:""});
      setShowAdminPassword(false);setAdminModalOpen(false);
      await loadAdmins();
    } catch(err:any) {
      setError(err?.message||"Création impossible. Vérifie la configuration de la fonction Cloudflare.");
    } finally { setAdminSaving(false); }
  };
  const openDetails = (row:Candidate) => { setSelected(row); setNewStatus(statusOf(row.status)); setInternalNote(String(row.internalNote??"")); setError(""); };
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
  const reviewRows=useMemo(()=>rows.filter(row=>["received","review"].includes(statusOf(row.status))).sort((a,b)=>{const t=(v:any)=>v?.toMillis?.()??(v?new Date(v).getTime():0);return t(a.createdAt)-t(b.createdAt)}),[rows]);
  const reviewPageCount=Math.max(1,Math.ceil(reviewRows.length/reviewPageSize));
  const visibleReviewRows=reviewRows.slice((reviewPage-1)*reviewPageSize,reviewPage*reviewPageSize);
  useEffect(()=>setReviewPage(1),[rows.length]);
  const assetsByCandidate = rows.map(row => ({
    candidate: row,
    files: [
      row.profilePhotoUrl||row.photoUrl ? {name:"Photo de profil",url:row.profilePhotoUrl||row.photoUrl}:null,
      row.portfolioFileUrl||row.portfolioUrl ? {name:"Création / portfolio",url:row.portfolioFileUrl||row.portfolioUrl}:null
    ].filter(Boolean) as {name:string;url:string}[]
  })).filter(item => item.files.length);

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

  return <section className={"admin-app" + (sidebarCollapsed ? " sidebar-collapsed" : "") + (mobileSidebarOpen ? " mobile-sidebar-open" : "")}>
    <div className="admin-sidebar-backdrop" onClick={()=>setMobileSidebarOpen(false)} aria-hidden="true"></div>
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
      <header className="admin-mobile-head"><div className="admin-mobile-brand-group"><button className="admin-menu-toggle-visible" type="button" onClick={()=>setMobileSidebarOpen(value=>!value)} aria-label={mobileSidebarOpen?"Fermer le menu":"Ouvrir le menu"} aria-expanded={mobileSidebarOpen}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button><div className="admin-brand"><span className="admin-brand-symbol">C</span><span>LA COMPASSION <b>DESIGN</b></span></div></div><button onClick={()=>signOut(auth)} aria-label="Déconnexion"><Icon name="logout"/></button></header>
      <div className="admin-page-head"><div><span className="admin-kicker">MASTERCLASS DESIGN · 15—19 DÉCEMBRE 2026</span><h1>{tab==="overview"?"Vue générale":tab==="candidates"?"Candidatures":tab==="downloads"?"Téléchargements":"Gestion des administrateurs"}</h1><p>{tab==="admins"?"Création et suivi des accès administrateurs.":"Suivi et gestion des dossiers de candidature."}</p></div><div className="admin-page-actions">{tab==="overview"&&<button className="admin-refresh admin-export-head" onClick={()=>downloadXlsx(rows)}>Exporter Excel</button>}<button className="admin-refresh" onClick={()=>{void loadCandidates();void loadCapacity()}} disabled={busy}><Icon name="refresh"/>{busy?"Actualisation…":"Actualiser"}</button></div></div>
      {error&&<p className="admin-error" role="alert">{error}</p>}
      {tab==="overview"&&<>
        <div className="admin-summary admin-kpi-summary">
          <article><span>Reçues</span><strong>{counts.received}</strong><small>Total de tous les dossiers</small></article>
          <article><span>À traiter</span><strong>{counts.pending}</strong><small>Reçues + En étude</small></article>
          <article><span>Acceptées</span><strong>{counts.accepted}</strong><small>Décisions positives</small></article>
          <article><span>En attente</span><strong>{counts.waiting}</strong><small>Liste d’attente</small></article>
        </div>
        <div className="admin-overview-meta">{capacity!==null&&<div className="admin-capacity-inline"><span>{counts.accepted} acceptés sur {capacity} places</span><div><i style={{width:Math.min(100,counts.accepted/capacity*100)+"%"}}/></div></div>}<span className="admin-countdown">{(()=>{const days=Math.max(0,Math.ceil((new Date(2026,11,15).getTime()-new Date(new Date().getFullYear(),new Date().getMonth(),new Date().getDate()).getTime())/86400000));return days===0?"Masterclass aujourd’hui":"J-"+days+" avant la Masterclass"})()}</span></div>
        <div className="admin-overview-columns">
          <section className="admin-section admin-review-queue">
            <div className="admin-section-head"><div><h2>Dossiers à examiner</h2><p>Les 5 plus anciens dossiers Reçue ou En étude.</p></div><button className="admin-text-action" onClick={()=>{setAttentionFilter("all");setTab("candidates")}}>Voir toutes les candidatures <Icon name="chevron"/></button></div>
            <div className="admin-review-table-head"><span>Candidat</span><span>Niveau</span><span>PC</span><span>Disponibilité</span><span>Statut</span><span>Date</span></div>
            {visibleReviewRows.length>0?<><div className="admin-review-list">{visibleReviewRows.map(row=><button type="button" className="admin-review-row" key={row.id} onClick={()=>openDetails(row)}><span className="admin-review-person"><b>{personName(row)}</b><small>{valueOf(row,"assembly","extension")}</small></span><span className="admin-review-level">{valueOf(row,"level")}</span><span className="admin-review-ram">{valueOf(row,"ram")}</span><span className={"admin-review-availability"+(String(row.availability??"").toLowerCase().includes("partiellement")?" partial":"")}>{valueOf(row,"availability")}{String(row.availability??"").toLowerCase().includes("partiellement")&&<small className="admin-partial-signal">À confirmer</small>}</span><StatusPill value={row.status}/><time>{dateLabel(row.createdAt)}</time></button>)}</div><div className="admin-review-pagination"><span>{reviewRows.length} dossiers · Page {reviewPage}/{reviewPageCount}</span><div><button type="button" disabled={reviewPage<=1} onClick={()=>setReviewPage(p=>Math.max(1,p-1))}>Précédent</button><button type="button" disabled={reviewPage>=reviewPageCount} onClick={()=>setReviewPage(p=>Math.min(reviewPageCount,p+1))}>Suivant</button></div></div></>:<p className="admin-empty">{busy?"Chargement des dossiers…":"Aucun dossier à examiner."}</p>}
          </section>
          <div className="admin-overview-side">
            <section className="admin-section admin-verify-card"><div className="admin-section-head"><div><h2>À vérifier</h2><p>Points nécessitant une vérification.</p></div></div>
              {[{key:"partial" as const,label:"Disponibilité partielle",count:rows.filter(r=>String(r.availability??"").toLowerCase().includes("partiellement")).length},{key:"ram" as const,label:"RAM non ou inconnue",count:rows.filter(r=>!["oui","yes","8 go","8gb","8 go ram"].includes(String(r.ram??"").trim().toLowerCase())).length},{key:"photo" as const,label:"Photo manquante",count:rows.filter(r=>!String(r.profilePhotoUrl||r.photoUrl||"").trim()).length},{key:"portfolio" as const,label:"Portfolio manquant",count:rows.filter(r=>!String(r.portfolioFileUrl||r.portfolioUrl||r.portfolio||"").trim()).length}].map(item=><button type="button" key={item.key} className={"admin-verify-item"+(item.count===0?" is-zero":"")} onClick={()=>{setAttentionFilter(item.key);setFilterStatus("all");setQuery("");setTab("candidates")}}><span>{item.label}</span><b>{item.count}</b><Icon name="chevron"/></button>)}
            </section>
            <section className="admin-section admin-decisions-card"><div className="admin-section-head"><div><h2>Dernières décisions</h2><p>Les 5 derniers changements de statut.</p></div></div>
              {rows.flatMap(row=>(Array.isArray(row.statusHistory)?row.statusHistory:[]).map((entry:any,index:number)=>({row,entry,index}))).sort((a,b)=>{const t=(v:any)=>v?.toMillis?.()??(v?new Date(v).getTime():0);return t(b.entry.changedAt)-t(a.entry.changedAt)}).slice(0,5).length?<div className="admin-decision-list">{rows.flatMap(row=>(Array.isArray(row.statusHistory)?row.statusHistory:[]).map((entry:any,index:number)=>({row,entry,index}))).sort((a,b)=>{const t=(v:any)=>v?.toMillis?.()??(v?new Date(v).getTime():0);return t(b.entry.changedAt)-t(a.entry.changedAt)}).slice(0,5).map(({row,entry,index})=><div className="admin-decision-row" key={row.id+"-"+index}><b>{personName(row)}</b><StatusPill value={entry.to}/><small>{admins.find(admin=>admin.id===entry.adminId)?.firstName||admins.find(admin=>admin.id===entry.adminId)?.email||("Admin "+String(entry.adminId??"").slice(0,6))}</small><time>{dateLabel(entry.changedAt)}</time></div>)}</div>:<p className="admin-empty">Aucune décision enregistrée.</p>}
            </section>
          </div>
        </div>
        <section className="admin-section admin-promotion-section"><div className="admin-section-head"><div><h2>Répartition de la promotion</h2><p>Répartition informative des candidatures et des acceptations.</p></div></div>
          {rows.length<5?<p className="admin-promotion-threshold">{rows.length} candidatures. Les graphiques apparaissent à partir de 5 dossiers.</p>:<div className="admin-promotion-grid">
            {[{title:"Genre",field:"gender",order:[] as string[]},{title:"Tranche d’âge",field:"age",order:["Moins de 18 ans","18–24 ans","18-24 ans","25–34 ans","25-34 ans","35–44 ans","35-44 ans","45 ans et plus"]},{title:"Niveau en design",field:"level",order:["Débutant","Intermédiaire","Avancé"]}].map(chart=>{const active=rows.filter(r=>statusOf(r.status)!=="refused");const cats=Array.from(new Set(active.map(r=>String(r[chart.field]??"").trim()||"Non renseigné"))).sort((a,b)=>{if(a==="Non renseigné")return 1;if(b==="Non renseigné")return -1;const ai=chart.order.findIndex(v=>v.toLowerCase()===a.toLowerCase()),bi=chart.order.findIndex(v=>v.toLowerCase()===b.toLowerCase());if(ai>=0||bi>=0)return (ai<0?999:ai)-(bi<0?999:bi);return a.localeCompare(b,"fr")});return <article className="admin-promotion-card" key={chart.field}><h3>{chart.title}</h3><div className="admin-promotion-bars">{cats.map(category=>{const n=active.filter(r=>(String(r[chart.field]??"").trim()||"Non renseigné")===category).length,accepted=active.filter(r=>statusOf(r.status)==="accepted"&&(String(r[chart.field]??"").trim()||"Non renseigné")===category).length;return <div className="admin-promotion-category" key={category}><b>{category}</b><div className="admin-promotion-track"><i className="applicants" style={{width:(n/active.length*100)+"%"}}/><span>{n} · {Math.round(n/active.length*100)}%</span></div><div className="admin-promotion-track"><i className="accepted" style={{width:(accepted/active.length*100)+"%"}}/><span>{accepted} · {Math.round(accepted/active.length*100)}%</span></div></div>})}</div><div className="admin-promotion-legend"><span><i className="applicants"/>Candidatures</span><span><i className="accepted"/>Acceptées</span></div></article>})}
          </div>}
        </section>
      </>}
      {tab==="candidates"&&<>
        <section className={"admin-toolbar" + (mobileFiltersOpen ? " mobile-filters-open" : "")}>
          <button type="button" className="admin-mobile-filter-toggle" onClick={()=>setMobileFiltersOpen(value=>!value)} aria-expanded={mobileFiltersOpen} aria-label={mobileFiltersOpen?"Masquer la recherche et les filtres":"Afficher la recherche et les filtres"} title="Recherche et filtres">
            <span>Recherche et filtres</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>
          </button>
          <div className="admin-toolbar-controls">
            <div className="admin-search"><Icon name="search"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Rechercher un nom ou un téléphone…" aria-label="Rechercher un candidat"/></div>
            <div className="admin-filters"><label><Icon name="filter"/><select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}><option value="all">Tous les statuts</option>{statusOptions.map(s=><option value={s.value} key={s.value}>{s.label}</option>)}</select></label>
              <select value={filterLevel} onChange={e=>setFilterLevel(e.target.value)}><option value="all">Tous les niveaux</option>{["Débutant","Intermédiaire","Avancé"].map(x=><option key={x}>{x}</option>)}</select>
              <select value={filterAssembly} onChange={e=>setFilterAssembly(e.target.value)}><option value="all">Toutes les assemblées</option>{Array.from(new Set(rows.map(r=>String(valueOf(r,"assembly","extension"))).filter(v=>v!=="—"))).map(x=><option key={x}>{x}</option>)}</select>
              <select value={filterRam} onChange={e=>setFilterRam(e.target.value)}><option value="all">Compatibilité PC</option>{["Oui","Non","Je ne sais pas"].map(x=><option key={x}>{x}</option>)}</select>
            </div>
          </div>
        </section>
        <section className="admin-section"><div className="admin-section-head"><div><h2>Liste des inscrits</h2><p>{filtered.length} dossier(s) correspondant aux filtres.</p></div></div>
          <CandidateTable rows={pageRows} onOpen={openDetails} startNumber={(currentPage - 1) * pageSize}/>
          {filtered.length > pageSize && <nav className="admin-pagination" aria-label="Pagination des candidatures"><span>Page {currentPage} sur {pageCount} · {filtered.length} dossiers</span><div><button type="button" disabled={currentPage===1} onClick={()=>setCurrentPage(p=>Math.max(1,p-1))}>Précédent</button>{Array.from({length:pageCount},(_,i)=>i+1).map(page=><button type="button" key={page} className={page===currentPage?"active":""} onClick={()=>setCurrentPage(page)}>{page}</button>)}<button type="button" disabled={currentPage===pageCount} onClick={()=>setCurrentPage(p=>Math.min(pageCount,p+1))}>Suivant</button></div></nav>}
          {!filtered.length&&<p className="admin-empty">{busy?"Chargement…":"Aucun dossier ne correspond à cette recherche."}</p>}
        </section>
      </>}
      {tab==="downloads"&&<section className="admin-section admin-downloads">
        <div className="admin-export-header">
          <div><span className="admin-export-eyebrow">EXPORT DES DONNÉES</span><h2>Liste des candidats</h2><p>Export complet des informations soumises dans le formulaire d’inscription.</p></div>
          <div className="admin-export-total"><b>{filtered.length}</b><span>candidat(s) à exporter</span></div>
        </div>
        <div className="admin-export-main">
          <div className="admin-export-file-icon"><Icon name="file"/></div>
          <div className="admin-export-copy"><b>Classeur Excel (.xlsx)</b><p>Un candidat par ligne, toutes les réponses, les coordonnées et les liens vers les pièces jointes.</p><small>{filtered.length} dossier(s) · {Object.keys(filtered[0]??{}).length||0} champs enregistrés au maximum</small></div>
          <button className="admin-primary admin-xlsx-button" disabled={!filtered.length} onClick={()=>downloadXlsx(filtered)}><Icon name="download"/> Télécharger Excel</button>
        </div>
        <div className="admin-export-footer"><span>Les filtres appliqués aux candidatures sont pris en compte dans l’export.</span><button className="admin-secondary" disabled={!filtered.length} onClick={()=>window.print()}>Imprimer la liste / PDF</button></div>
        <div className="admin-section-head admin-assets-head"><div><h2>Documents des candidats</h2><p>Chaque dossier regroupe les pièces jointes sous le nom du candidat.</p></div><span className="admin-assets-count">{assetsByCandidate.length} dossier(s)</span></div>
        <div className="admin-download-groups">
          {assetsByCandidate.map(({candidate,files})=>{
            const photo=files.find(file=>file.name==="Photo de profil");
            const portfolio=files.find(file=>file.name==="Création / portfolio");
            const renderFile=(file: {name:string;url:string}|undefined,kind:"photo"|"portfolio")=><div className={`admin-download-file-cell ${kind}`}>
              <span className="admin-download-file-bubble">{kind==="photo"?"PHOTO DE PROFIL":"PORTFOLIO"}</span>
              {file?<><button type="button" className="admin-download-preview" onClick={()=>setPreviewAsset({name:personName(candidate),label:file.name,url:file.url})}>Aperçu</button><a className="admin-download-link" href={file.url} target="_blank" rel="noreferrer" download>Télécharger <Icon name="download"/></a></>:<span className="admin-download-missing">Non fourni</span>}
            </div>;
            return <article className="admin-download-candidate" key={candidate.id}>
              <div className="admin-download-candidate-head">
                <div className="admin-download-avatar">{personName(candidate).trim().charAt(0).toUpperCase()}</div>
                <div className="admin-download-candidate-info"><b>{personName(candidate)}</b><span>{valueOf(candidate,"phone")} · {valueOf(candidate,"email")}</span><small>{dateLabel(candidate.createdAt)}</small></div>
                <StatusPill value={candidate.status}/>
              </div>
              <div className="admin-download-files-grid">
                {renderFile(photo,"photo")}
                {renderFile(portfolio,"portfolio")}
              </div>
            </article>;
          })}
        </div>
        {!assetsByCandidate.length&&<p className="admin-empty">Aucun fichier n’est encore associé aux candidatures.</p>}
      </section>}
      {tab==="admins"&&role==="superAdmin"&&<section className="admin-section admin-manage-admins">
        <div className="admin-section-head"><div><h2>Équipe d’administration</h2><p>La création des comptes sera réactivée après configuration de la fonction Cloudflare sécurisée.</p></div><button className="admin-primary" type="button" disabled title="La fonction serveur sécurisée doit être configurée avant toute création de compte.">Création sécurisée indisponible</button></div>
        <div className="admin-admin-list">{admins.map(item=><article className="admin-admin-row" key={item.id}><span className="admin-admin-avatar">{(item.firstName||item.email||"A").slice(0,1).toUpperCase()}</span><div className="admin-admin-info"><b>{[item.firstName,item.lastName].filter(Boolean).join(" ")||"Administrateur"}</b><small>{item.email||"—"}</small></div><span className={"admin-role-pill "+(item.role==="superAdmin"?"super":"")}>{item.role==="superAdmin"?"Super administrateur":"Administrateur"}</span><span className={"admin-active-pill "+(item.active?"active":"")}>{item.active?"Actif":"Désactivé"}</span><button type="button" className="admin-admin-open" onClick={()=>openAdminDetails(item)}>Voir / Modifier</button></article>)}</div>
        {!admins.length&&<p className="admin-empty">Aucun administrateur trouvé.</p>}
      </section>}
    </main>
    {selectedAdmin&&role==="superAdmin"&&<div className="admin-edit-overlay" onClick={()=>!adminEditSaving&&setSelectedAdmin(null)}>
      <form className="admin-edit-card admin-create-admin-modal" onSubmit={saveAdminDetails} onClick={e=>e.stopPropagation()}>
        <div className="admin-drawer-head"><div><span className="admin-kicker">FICHE ADMINISTRATEUR</span><h2>{[selectedAdmin.firstName,selectedAdmin.lastName].filter(Boolean).join(" ")||"Administrateur"}</h2></div><button type="button" onClick={()=>setSelectedAdmin(null)} disabled={adminEditSaving} aria-label="Fermer"><Icon name="close"/></button></div>
        <p className="admin-modal-description">Consulte et modifie les informations du compte administrateur.</p>
        <div className="admin-form-grid">
          <label>Prénom<input value={adminEditForm.firstName} onChange={e=>setAdminEditForm(v=>({...v,firstName:e.target.value}))} required maxLength={60}/></label>
          <label>Nom<input value={adminEditForm.lastName} onChange={e=>setAdminEditForm(v=>({...v,lastName:e.target.value}))} required maxLength={60}/></label>
        </div>
        <label>Adresse e-mail de connexion<input value={selectedAdmin.email??""} readOnly/><small>L’adresse de connexion est gérée par Firebase Authentication et ne peut pas être modifiée ici.</small></label>
        <label>Rôle<input value={selectedAdmin.role==="superAdmin"?"Super administrateur":"Administrateur"} readOnly/></label>
        <label className="admin-admin-active-toggle"><input type="checkbox" checked={adminEditForm.active} onChange={e=>setAdminEditForm(v=>({...v,active:e.target.checked}))}/> Compte actif — autoriser l’accès à l’espace admin</label>
        {error&&<p className="admin-error" role="alert">{error}</p>}
        <div className="admin-create-modal-actions"><button type="button" className="admin-secondary" disabled={adminEditSaving} onClick={()=>setSelectedAdmin(null)}>Fermer</button><button className="admin-primary" type="submit" disabled={adminEditSaving}>{adminEditSaving?"Enregistrement…":"Enregistrer les modifications"}</button></div>
      </form>
    </div>}
    {adminModalOpen&&role==="superAdmin"&&<div className="admin-edit-overlay" onClick={()=>!adminSaving&&setAdminModalOpen(false)}>
      <form className="admin-edit-card admin-create-admin-modal" onSubmit={createAdmin} onClick={e=>e.stopPropagation()}>
        <div className="admin-drawer-head"><div><span className="admin-kicker">ACCÈS ET AUTORISATIONS</span><h2>Créer un administrateur</h2></div><button type="button" onClick={()=>setAdminModalOpen(false)} disabled={adminSaving} aria-label="Fermer"><Icon name="close"/></button></div>
        <p className="admin-modal-description">Ce compte aura accès aux candidatures et aux téléchargements, sans les droits du super administrateur.</p>
        <div className="admin-form-grid"><label>Prénom<input autoFocus value={adminForm.firstName} onChange={e=>setAdminForm(v=>({...v,firstName:e.target.value}))} required maxLength={60}/></label><label>Nom<input value={adminForm.lastName} onChange={e=>setAdminForm(v=>({...v,lastName:e.target.value}))} required maxLength={60}/></label></div>
        <label>Adresse e-mail de connexion<div className="admin-generated-email">{((adminForm.firstName+adminForm.lastName).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,""))||"prenomnom"}<span>@design.cmps</span></div><small>Générée automatiquement à partir du prénom et du nom.</small></label>
        <label>Mot de passe temporaire<div className="admin-password-field"><input type={showAdminPassword?"text":"password"} autoComplete="new-password" minLength={8} value={adminForm.password} onChange={e=>setAdminForm(v=>({...v,password:e.target.value}))} required/><button type="button" onClick={()=>setShowAdminPassword(value=>!value)} aria-label={showAdminPassword?"Masquer le mot de passe":"Afficher le mot de passe"} title={showAdminPassword?"Masquer":"Afficher"}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{showAdminPassword&&<path d="m3 3 18 18"/>}</svg></button></div><small>8 caractères minimum. Firebase sécurise et hache le mot de passe lors de la création du compte.</small></label>
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
        <div className="admin-detail-section">
          <h3>Informations personnelles</h3>
          <div className="admin-detail-list">
            {[
              ["Nom complet",valueOf(selected,"fullName","name")],["Genre",valueOf(selected,"gender")],
              ["Téléphone",valueOf(selected,"phone")],["E-mail",valueOf(selected,"email")],
              ["Âge",valueOf(selected,"age")],["Commune / quartier",valueOf(selected,"area","commune")]
            ].map(([label,value])=><div key={label}><small>{label}</small><b>{String(value)}</b></div>)}
          </div>
        </div>
        <div className="admin-detail-section">
          <h3>Parcours dans l’église</h3>
          <div className="admin-detail-list">
            {[
              ["Membre de l’Église",valueOf(selected,"member")],["Ancienneté / durée de présence",valueOf(selected,"attendance")],
              ["Assemblée / extension",valueOf(selected,"assembly","extension")],["Département",valueOf(selected,"department")],
              ["Maturité spirituelle",valueOf(selected,"maturity")]
            ].map(([label,value])=><div key={label}><small>{label}</small><b>{String(value)}</b></div>)}
          </div>
        </div>
        <div className="admin-detail-section">
          <h3>Profil et compétences en design</h3>
          <div className="admin-detail-list">
            {[
              ["Niveau en design",valueOf(selected,"level")],["Outils maîtrisés",valueOf(selected,"tools")],
              ["Lien du portfolio",valueOf(selected,"portfolio")]
            ].map(([label,value])=><div key={label}><small>{label}</small><b>{Array.isArray(value)?value.join(", "):String(value)}</b></div>)}
          </div>
          {selected.portfolio&&String(selected.portfolio)!=="—"&&/^https?:\/\//i.test(String(selected.portfolio))&&<a className="admin-file-link" href={String(selected.portfolio)} target="_blank" rel="noreferrer">Ouvrir le lien du portfolio</a>}
          {selected.portfolioFileUrl||selected.portfolioUrl?<button type="button" className="admin-file-link" onClick={()=>{setPreviewZoom(1);setPreviewAsset({name:personName(selected),label:"Création / portfolio",url:selected.portfolioFileUrl||selected.portfolioUrl||""})}}>Consulter la création jointe</button>:<p className="admin-detail-empty">Aucun fichier de création joint.</p>}
        </div>
        <div className="admin-detail-section">
          <h3>Disponibilité et engagement</h3>
          <div className="admin-detail-list">
            {[
              ["Ordinateur · RAM",valueOf(selected,"ram")],["Disponibilité pour la formation",valueOf(selected,"availability")],
              ["Motivation",valueOf(selected,"motivation")],["Engagement à rejoindre le département Design",valueOf(selected,"commitment")]
            ].map(([label,value])=><div key={label}><small>{label}</small><b>{String(value)}</b></div>)}
            <div><small>Date de candidature</small><b>{dateLabel(selected.createdAt)}</b></div>
          </div>
        </div>
        <div className="admin-detail-section admin-contact-actions">
          <h3>Contacter le candidat</h3>
          <div className="admin-contact-links">{String(selected.phone??"").replace(/\D/g,"").length>=9&&<><a href={"tel:"+String(selected.phone).replace(/[^+0-9]/g,"")}>Appeler</a><a href={"https://wa.me/243"+String(selected.phone).replace(/\D/g,"").replace(/^243/,"")} target="_blank" rel="noreferrer">WhatsApp</a></>}</div>
        </div>
        <div className="admin-detail-section">
          <h3>Suivi administratif</h3>
          <div className="admin-detail-list"><div><small>Dernière modification</small><b>{selected.reviewedBy?("Administrateur "+String(selected.reviewedBy).slice(0,8)+" · "+dateLabel(selected.reviewedAt)):"Aucune décision enregistrée"}</b></div></div>
          <label className="admin-internal-note">Note interne<textarea rows={4} value={internalNote} onChange={e=>setInternalNote(e.target.value)} placeholder="Ajouter une observation réservée à l’équipe administrative…"/></label>
          <button type="button" className="admin-secondary admin-full" onClick={()=>void saveInternalNote()} disabled={noteSaving}>{noteSaving?"Enregistrement…":"Enregistrer la note"}</button>
        </div>
        <div className="admin-status-action-row">
          <label className="admin-status-select">Décision sur le dossier<select value={newStatus} onChange={e=>setNewStatus(e.target.value as Status)}>{statusOptions.map(s=><option value={s.value} key={s.value}>{s.label}</option>)}</select></label>
          <button className="admin-primary admin-full" onClick={()=>void changeStatus(selected,newStatus)}>Enregistrer le statut</button>
        </div>
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

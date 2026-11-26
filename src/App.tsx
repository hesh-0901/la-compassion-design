import { Children, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import AdminPanel from "./AdminPanel";
import { createPortal } from "react-dom";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

type Step = "home" | "presentation" | "registration" | "confirmation" | "admin";
type FormData = {
  fullName: string; gender: string; phone: string; email: string; area: string; areaOther: string; age: string;
  member: string; extension: string; attendance: string; department: string; maturity: string; level: string; tools: string[];
  portfolio: string; ram: string; availability: string; motivation: string; commitment: boolean;
};
const initialForm: FormData = {
  fullName: "", gender: "", phone: "", email: "", area: "", areaOther: "", age: "", member: "", attendance: "",
  extension: "", department: "", maturity: "", level: "", tools: [], portfolio: "", ram: "", availability: "",
  motivation: "", commitment: false,
};
const steps = ["Toi", "Ton parcours", "Ton engagement"];

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    calendar: "M6 1v2m12-2v2M3 8h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
    clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-16v6l4 2",
    gift: "M20 12v9H4v-9m-2-5h20v5H2zm10 0v14m0-14H7a2.5 2.5 0 1 1 2.5-2.5C9.5 5 12 7 12 7Zm0 0h5a2.5 2.5 0 1 0-2.5-2.5C14.5 5 12 7 12 7Z",
    people: "M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m6-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm6-7a4 4 0 0 1 0 8m2 3a4 4 0 0 1 4 4v2",
    laptop: "M4 5h16v12H4zM2 21h20l-2-4H4z",
    member: "M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m6-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-2 2 2 4-4",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    back: "M19 12H5m6 6-6-6 6-6",
    check: "m5 12 4 4L19 6",
    info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-14v.01M12 11v6",
    login: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5m5 5H3",
    laptopCheck: "M4 5h16v12H4zM2 21h20l-2-4H4zm7-10 2 2 4-4",
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.info} /></svg>;
}

export default function App() {
  const [step, setStep] = useState<Step>(() => {
    const path = window.location.pathname;
    if (path.startsWith("/presentation")) return "presentation";
    if (path.startsWith("/inscription")) return "registration";
    if (path.startsWith("/confirmation")) return "confirmation";
    if (path.startsWith("/admin")) return "admin";
    return "home";
  });
  const [form, setForm] = useState<FormData>(initialForm);
  const [publicConfig,setPublicConfig] = useState<{capacity:number|null;currentCandidates:number;whatsappGroupLink:string}>({capacity:null,currentCandidates:0,whatsappGroupLink:""});
  const [publicConfigLoaded,setPublicConfigLoaded] = useState(false);
  const [part, setPart] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [showMemberNotice, setShowMemberNotice] = useState(false);
  const [showRamNotice, setShowRamNotice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [portfolioFile, setPortfolioFile] = useState<File | null>(null);
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);
  const [photoSourceOpen, setPhotoSourceOpen] = useState(false);
  const [photoSourcePosition, setPhotoSourcePosition] = useState({top:0,left:0,width:288});
  const photoPickerRef = useRef<HTMLButtonElement>(null);
  const [photoToCrop, setPhotoToCrop] = useState<File | null>(null);
  const filesPhotoInput = useRef<HTMLInputElement>(null);
  const cameraPhotoInput = useRef<HTMLInputElement>(null);

  const go = (next: Step) => {
    setStep(next);
    const path = next === "home" ? "/" : next === "presentation" ? "/presentation" : next === "registration" ? "/inscription" : next === "admin" ? "/admin" : "/confirmation";
    window.history.pushState({ step: next }, "", path);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  useEffect(() => {
    if(step!=="presentation"&&step!=="registration")return;
    let active=true;
    fetch("/api/public-config").then(response=>response.ok?response.json():Promise.reject(new Error("Configuration indisponible"))).then(data=>{if(active){setPublicConfig({capacity:Number.isFinite(Number(data.capacity))&&Number(data.capacity)>0?Number(data.capacity):null,currentCandidates:Number(data.currentCandidates)||0,whatsappGroupLink:String(data.whatsappGroupLink||"")});setPublicConfigLoaded(true);}}).catch(()=>{if(active)setPublicConfigLoaded(true);});
    return()=>{active=false;};
  },[step]);
  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname;
      setStep(path.startsWith("/presentation") ? "presentation" : path.startsWith("/inscription") ? "registration" : path.startsWith("/confirmation") ? "confirmation" : path.startsWith("/admin") ? "admin" : "home");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const update = (key: keyof FormData, value: string | boolean | string[]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => prev.filter(item => item !== key));
  };
  const phoneDigits = form.phone.replace(/\D/g, "");
  const validate = () => {
    const required: (keyof FormData)[] = part === 0
      ? ["fullName", "gender", "phone", "area", "age"]
      : part === 1 ? ["member", "extension", "attendance", "department", "maturity", "level"]
      : ["ram", "availability", "motivation", "commitment"];
    const missing = required.filter(key => {
      const value = form[key];
      return key === "area" ? (form.area === "Autre" ? !form.areaOther.trim() : !form.area.trim()) : typeof value === "string" ? !value.trim() : typeof value === "boolean" ? !value : false;
    }).map(String);
    if (part === 0 && phoneDigits.length !== 9) missing.push("phone");
    if (part === 1 && form.member !== "Oui") missing.push("member");
    if (part === 2 && !profilePhoto) missing.push("profilePhoto");
    setErrors(missing);
    return missing.length === 0;
  };
  const uploadToCloudinary = async (file: File, kind: "image" | "raw") => {
    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset) throw new Error("La configuration Cloudinary est absente. Vérifie les variables Cloudflare.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Chaque fichier doit peser 10 Mo maximum.");
    const payload = new FormData();
    payload.append("file", file);
    payload.append("upload_preset", uploadPreset);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${kind}/upload`, { method: "POST", body: payload });
    const rawResponse = await response.text();
    let result: { secure_url?: string; public_id?: string; error?: { message?: string } };
    try {
      result = JSON.parse(rawResponse) as typeof result;
    } catch {
      throw new Error(`Cloudinary a renvoyé une réponse illisible (HTTP ${response.status}).`);
    }
    if (!response.ok || !result.secure_url || !result.public_id) {
      throw new Error(result.error?.message || `Le téléversement Cloudinary a échoué (HTTP ${response.status}).`);
    }
    return { url: result.secure_url, publicId: result.public_id };
  };

  const submitApplication = async () => {
    if (!validate() || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    let currentStage = "Vérification de la disponibilité des places";
    try {
      const capacityResponse=await fetch("/api/public-config");
      if(!capacityResponse.ok)throw new Error("Impossible de vérifier la disponibilité des places. Réessaie dans un instant.");
      const latestConfig=await capacityResponse.json() as {capacity?:number|null;currentCandidates?:number};
      if(typeof latestConfig.capacity==="number"&&Number(latestConfig.capacity)>0&&Number(latestConfig.currentCandidates)>=Number(latestConfig.capacity))throw new Error("Les candidatures sont clôturées : le nombre maximal de candidats a été atteint.");
      currentStage = "Vérification des candidatures en double";
      const duplicateResponse = await fetch("/api/check-duplicate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName: form.fullName.trim(), email: form.email.trim(), phone: "+243" + phoneDigits }),
      });
      const duplicateResult = await duplicateResponse.json().catch(() => ({})) as { duplicate?: boolean; message?: string; error?: string };
      if (!duplicateResponse.ok) throw new Error(duplicateResult.message || duplicateResult.error || "La vérification des doublons a échoué. Réessaie.");
      if (duplicateResult.duplicate) throw new Error(duplicateResult.message || "Une candidature existe déjà avec ces informations.");
      if (!profilePhoto || !profilePhoto.type.startsWith("image/")) throw new Error("Ajoute une photo de profil au format image.");
      currentStage = "Téléversement de la photo de profil";
      const photo = await uploadToCloudinary(profilePhoto, "image");
      let portfolioUpload: { url: string; publicId: string } | null = null;
      if (portfolioFile) {
        const imageFile = portfolioFile.type.startsWith("image/");
        const pdfFile = portfolioFile.type === "application/pdf" || portfolioFile.name.toLowerCase().endsWith(".pdf");
        if (!imageFile && !pdfFile) throw new Error("La création jointe doit être une image ou un PDF.");
        currentStage = "Téléversement du portfolio";
        portfolioUpload = await uploadToCloudinary(portfolioFile, imageFile ? "image" : "raw");
      }
      currentStage = "Enregistrement de la candidature dans Firestore";
      const candidateRef = await addDoc(collection(db, "candidatures"), {
        fullName: form.fullName.trim(),
        gender: form.gender,
        phone: "+243" + phoneDigits,
        email: form.email.trim(),
        area: (form.area === "Autre" ? form.areaOther : form.area).trim(),
        age: form.age,
        member: form.member,
        extension: form.extension,
        attendance: form.attendance,
        department: form.department,
        maturity: form.maturity,
        level: form.level,
        tools: form.tools,
        portfolio: form.portfolio.trim(),
        portfolioFileUrl: portfolioUpload?.url || "",
        portfolioPublicId: portfolioUpload?.publicId || "",
        profilePhotoUrl: photo.url,
        profilePhotoPublicId: photo.publicId,
        ram: form.ram,
        availability: form.availability,
        motivation: form.motivation,
        commitment: form.commitment,
        status: "received",
        createdAt: serverTimestamp(),
      });
      // L'inscription est déjà enregistrée : une panne e-mail ne doit jamais annuler la confirmation à l'écran.
      void fetch("/api/notify-registration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId: candidateRef.id }),
      }).then(async response => {
        const result = await response.json().catch(() => null) as { ok?: boolean; notifications?: Record<string, string>; error?: string } | null;
        if (!response.ok || !result?.ok) console.error("Notifications d'inscription incomplètes :", result);
        else console.info("Notifications d'inscription :", result.notifications);
      }).catch(error => console.error("Service de notification indisponible :", error));
      go("confirmation");
    } catch (error) {
      console.error("[registration] Échec de soumission", { stage: currentStage, error });
      const message = error instanceof Error ? error.message : "Une erreur est survenue pendant l’envoi.";
      setSubmitError(`${currentStage} : ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const nextPart = () => {
    if (!validate()) return;
    if (part < 2) { setPart(p => p + 1); window.scrollTo({ top: 0, behavior: "smooth" }); }
    else void submitApplication();
  };
  const canContinue = useMemo(() => part < 2, [part]);

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      {step === "home" && <section className="home-screen">
        <button className="admin-login-icon" type="button" aria-label="Accéder à l’espace d’administration" title="Espace administration" onClick={() => go("admin")}><Icon name="login" size={19} /></button>
        <div className="poster-frame">
          <img className="poster" src="/images/masterclass-design.png" alt="Masterclass Design, intensive et pratique, du 15 au 19 décembre 2026, de 19h à 22h." />
        </div>
        <h1 className="home-question">Souhaites-tu participer à la Masterclass Design&nbsp;?</h1>
        <button className="button button-primary home-button" onClick={() => go("presentation")}>J’accepte <Icon name="arrow" size={21} /></button>
      </section>}

      {step === "admin" && <AdminPanel onHome={() => go("home")} />}

      {step === "presentation" && <div className="flow-screen">
        <header className="brand-row"><span className="brand-mark">C</span><span>LA COMPASSION <b>DESIGN</b></span></header>
        <Progress active={0} />
        <button className="back-button" onClick={() => go("home")}><Icon name="back" size={18} /> Retour</button>
        <section className="intro-block">
          <span className="eyebrow">MASTERCLASS DESIGN · DÉCEMBRE 2026</span>
          <h1>Apprends à créer.<br /><span>Conçois avec impact.</span></h1>
          <p className="lead">Cinq soirées intensives pour acquérir les bases du design graphique et créer des visuels utiles au département.</p>
        </section>
        <section className="key-grid" aria-label="Informations clés">
          <Info icon="calendar" label="Dates" value="15 — 19 décembre 2026" />
          <Info icon="clock" label="Horaires" value="19h00 — 22h00" />
          <Info icon="gift" label="Participation" value="Entièrement gratuite" />
          <Info icon="people" label="Disponibilité" value="Places limitées" />
        </section>
        <div className="places-strip"><span className="place-dot" /> {publicConfig.capacity!==null?`${Math.max(0,publicConfig.capacity-publicConfig.currentCandidates)} place(s) disponible(s) sur ${publicConfig.capacity}.`:"Les places sont limitées. Les candidatures seront étudiées par l’équipe."}</div>
        {publicConfigLoaded&&publicConfig.capacity!==null&&publicConfig.currentCandidates>=publicConfig.capacity&&<div className="submit-notice" role="status"><Icon name="info"/><div><b>Inscriptions clôturées</b><p>Le nombre maximal de candidatures a été atteint. Le formulaire n’est plus disponible pour cette session.</p></div></div>}
        <section className="content-section">
          <h2>Ce que tu vas apprendre</h2>
          <ul className="clean-list">
            <li><span className="list-check"><Icon name="check" size={16} /></span> Reproduire un visuel de communication sur Photoshop.</li>
            <li><span className="list-check"><Icon name="check" size={16} /></span> Maîtriser les bases de la composition, des couleurs et de la typographie.</li>
            <li><span className="list-check"><Icon name="check" size={16} /></span> Concevoir des supports adaptés aux activités de l’Église.</li>
          </ul>
        </section>
        <section className="content-section conditions">
          <h2>Conditions de participation</h2>
          <ol>
            <li>Être membre de l’Église de la Compassion.</li>
            <li>Être disponible pendant les cinq soirées de formation.</li>
            <li>Disposer d’un ordinateur avec au moins 8 Go de RAM.</li>
            <li>Être prêt à rejoindre le département Design après la formation.</li>
          </ol>
        </section>
        <div className="commitment-note"><Icon name="info" size={22} /><p>Cette formation vise aussi à renforcer l’équipe du département Design. Ta candidature implique donc une volonté de servir dans ce département après la formation.</p></div>
        <div className="action-bar"><button className="button button-primary" disabled={publicConfigLoaded&&publicConfig.capacity!==null&&publicConfig.currentCandidates>=publicConfig.capacity} onClick={() => { setPart(0); go("registration"); }}> {publicConfigLoaded&&publicConfig.capacity!==null&&publicConfig.currentCandidates>=publicConfig.capacity?"Inscriptions clôturées":"Je veux candidater"} <Icon name="arrow" /></button></div>
      </div>}

      {step === "registration" && <div className="flow-screen form-screen">
        <header className="brand-row"><span className="brand-mark">C</span><span>LA COMPASSION <b>DESIGN</b></span></header>
        <Progress active={1} />
        <button className="back-button" onClick={() => part > 0 ? setPart(p => p - 1) : go("presentation")}><Icon name="back" size={18} /> Retour</button>
        <div className="form-heading">
          <span className="eyebrow">CANDIDATURE · ÉTAPE {part + 1}/3</span>
          <h1>{steps[part]}</h1>
          <p>{part === 0 ? "Commençons par faire connaissance." : part === 1 ? "Parle-nous de ton parcours à l’église et en design." : "Vérifions ensemble tes disponibilités et ton engagement."}</p>
        </div>
        <div className="step-track" aria-label={`Étape ${part + 1} sur 3`}>{steps.map((label, i) => <div className={i <= part ? "track-segment active" : "track-segment"} key={label}><span>{i + 1}</span><small>{label}</small></div>)}</div>

        {part === 0 && <div className="fields">
          <Field label="Nom complet" error={errors.includes("fullName") ? "Indique ton nom complet." : ""}><input autoComplete="name" value={form.fullName} onChange={e => update("fullName", e.target.value)} placeholder="Ex. Jean Kabeya" /></Field>
          <Field label="Genre" error={errors.includes("gender") ? "Choisis ton genre." : ""}><Choice value={form.gender} onChange={v => update("gender", v)} options={["Homme", "Femme"]} /></Field>
          <Field label="Numéro WhatsApp" error={errors.includes("phone") ? "Le numéro doit contenir 9 chiffres après +243." : ""}><div className="phone-input"><span>+243</span><input inputMode="numeric" autoComplete="tel-national" value={form.phone} onChange={e => update("phone", e.target.value.replace(/\D/g, "").slice(0, 9))} placeholder="81 234 56 78" /></div></Field>
          <Field label="Adresse e-mail" hint="Facultatif"><input type="email" autoComplete="email" value={form.email} onChange={e => update("email", e.target.value)} placeholder="nom@exemple.com" /></Field>
          <Field label="Commune de résidence" error={errors.includes("area") ? "Choisis ta commune de résidence." : ""}>
            <Dropdown value={form.area} onChange={v=>{update("area",v);if(v!=="Autre")update("areaOther","");}} placeholder="Sélectionner une commune" options={["Annexe","Kamalondo","Kampemba","Katuba","Kenya","Lubumbashi","Ruashi","Autre"]}/>
            {form.area==="Autre"&&<div className="field-extra"><label className="field-label" htmlFor="area-other">Précise ta commune ou ton quartier</label><input id="area-other" autoComplete="address-level2" value={form.areaOther} onChange={e=>update("areaOther",e.target.value)} placeholder="Indique ta commune ou ton quartier"/></div>}
          </Field>
          <Field label="Tranche d’âge" error={errors.includes("age") ? "Choisis une tranche d’âge." : ""}><Choice value={form.age} onChange={v => update("age", v)} options={["Moins de 18 ans", "18–24 ans", "25–34 ans", "35 ans et plus"]} /></Field>
        </div>}

        {part === 1 && <div className="fields">
          <Field label="Es-tu membre de l’Église de la Compassion ?" error={errors.includes("member") ? "Cette masterclass est réservée aux membres de l’Église de la Compassion." : ""}><Choice value={form.member} onChange={v => { update("member", v); setShowMemberNotice(v === "Non"); }} options={["Oui", "Non"]} /></Field>
          {showMemberNotice && <Notice>Cette masterclass est réservée aux membres de l’Église de la Compassion. Tu ne peux pas poursuivre ta candidature si tu n’es pas membre.</Notice>}
          <Field label="Depuis quand fréquentes-tu l’église ?" error={errors.includes("attendance") ? "Précise depuis quand." : ""}><Dropdown value={form.attendance} onChange={v=>update("attendance",v)} placeholder="Sélectionner" options={["Moins d’un an","1 à 3 ans","3 à 5 ans","Plus de 5 ans"]}/></Field>
          <Field label="Dans quelle extension es-tu ?" error={errors.includes("extension") ? "Choisis ton extension." : ""}><Dropdown value={form.extension} onChange={v=>update("extension",v)} placeholder="Sélectionner une extension" options={["Ville (centrale)","Golf plateau 1","Kimbeimbe","Tabac Congo","Golf Faustin"]}/></Field>
          <Field label="Dans quel département sers-tu ?" error={errors.includes("department") ? "Choisis ton département." : ""}><Dropdown value={form.department} onChange={v=>update("department",v)} placeholder="Sélectionner un département" options={["Presse","Chorale","Accueil","Intercession","Ecodim","Aucun","Autres"]}/></Field>
          <Field label="Quel est ton niveau d’affermissement ?" error={errors.includes("maturity") ? "Choisis ton niveau d’affermissement." : ""}><Choice value={form.maturity} onChange={v => update("maturity", v)} options={["Niveau 1", "Niveau 2", "Niveau 3", "Niveau 4", "Non affermi", "Affermi(e)"]} /></Field>
          <Field label="Ton niveau actuel en design" error={errors.includes("level") ? "Choisis ton niveau." : ""}><Choice value={form.level} onChange={v => update("level", v)} options={["Débutant", "Intermédiaire", "Avancé"]} /></Field>
          <Field label="Quels outils as-tu déjà utilisés ?" hint="Plusieurs choix possibles"><div className="chip-list">{["Canva", "Photoshop", "Illustrator", "Figma", "Autre"].map(tool => <button type="button" key={tool} className={form.tools.includes(tool) ? "chip selected" : "chip"} onClick={() => update("tools", form.tools.includes(tool) ? form.tools.filter(x => x !== tool) : [...form.tools, tool])}>{form.tools.includes(tool) && <Icon name="check" size={14} />}{tool}</button>)}</div></Field>
          <Field label="As-tu un lien ou un fichier d’une création déjà réalisée ?" hint="Facultatif — lien ou fichier"><input type="url" value={form.portfolio} onChange={e => update("portfolio", e.target.value)} placeholder="Colle un lien (facultatif)" /><input className="file-input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => setPortfolioFile(e.target.files?.[0] || null)} /><span className="file-hint">{portfolioFile ? portfolioFile.name : "Ajouter un fichier (image ou PDF, 10 Mo maximum)"}</span></Field>
        </div>}

        {part === 2 && <div className="fields">
          <Field label="Ton ordinateur a-t-il au moins 8 Go de RAM ?" error={errors.includes("ram") ? "Choisis une réponse." : ""}><Choice value={form.ram} onChange={v => { update("ram", v); setShowRamNotice(v === "Non"); }} options={["Oui", "Non", "Je ne sais pas"]} /></Field>
          {showRamNotice && <Notice>Un ordinateur avec au moins 8 Go de RAM est nécessaire pour suivre les exercices pratiques. Tu peux vérifier cette information dans les paramètres de ton appareil.</Notice>}
          <Field label="Seras-tu disponible du 15 au 19 décembre, de 19h à 22h ?" error={errors.includes("availability") ? "Indique ta disponibilité." : ""}><Choice value={form.availability} onChange={v => update("availability", v)} options={["Oui", "Partiellement"]} /></Field>
          <Field label="Pourquoi veux-tu suivre cette Masterclass ?" error={errors.includes("motivation") ? "Choisis une motivation." : ""}><Dropdown value={form.motivation} onChange={v=>update("motivation",v)} placeholder="Sélectionner une raison" options={["Me cultiver","Rejoindre le département Design","Contribuer aux créations visuelles de mon département","Autres"]}/></Field>
          <label className={errors.includes("commitment") ? "commitment-check invalid" : "commitment-check"}><input type="checkbox" checked={form.commitment} onChange={e => update("commitment", e.target.checked)} /><span>Je m’engage à rejoindre le département Design après la formation.</span></label>
          {errors.includes("commitment") && <p className="field-error">Confirme ton engagement pour continuer.</p>}
          <Field label="Ajoute une photo de profil" error={errors.includes("profilePhoto") ? "Ta photo de profil est requise." : ""} hint="Choisis une photo, puis ajuste son cadrage avant de la valider.">
            <button type="button" ref={photoPickerRef} className={"profile-photo-picker"+(profilePhoto?" has-photo":"")} onClick={()=>{const rect=photoPickerRef.current?.getBoundingClientRect();if(rect){const width=Math.min(248,window.innerWidth-32);setPhotoSourcePosition({top:Math.max(8,rect.top-104),left:Math.max(8,Math.min(window.innerWidth-width-8,rect.left+rect.width/2-width/2)),width});}setPhotoSourceOpen(true);}}>
              {profilePhoto ? <><span className="profile-photo-selected-mark"><Icon name="check" size={20}/></span><span><b>Photo prête</b><small>Appuie pour modifier ou recadrer</small></span></> : <><span className="profile-photo-picker-icon"><Icon name="info" size={22}/></span><span><b>Ajouter une photo de profil</b><small>Fichiers ou appareil photo · recadrage personnalisable</small></span></>}
              <span className="profile-photo-picker-action">{profilePhoto?"Modifier":"Choisir"}</span>
            </button>
            <input ref={filesPhotoInput} className="visually-hidden-file" type="file" accept=".jpg,.jpeg,.png,.webp" onChange={e=>{const file=e.target.files?.[0];if(file)setPhotoToCrop(file);e.currentTarget.value="";}}/>
            <input ref={cameraPhotoInput} className="visually-hidden-file" type="file" accept="image/*" capture="user" onChange={e=>{const file=e.target.files?.[0];if(file)setPhotoToCrop(file);e.currentTarget.value="";}}/>
            {profilePhoto&&<span className="file-hint">Photo recadrée : {profilePhoto.name}</span>}
            {photoSourceOpen&&createPortal(<div className="photo-source-overlay" onClick={()=>setPhotoSourceOpen(false)}><section className="photo-source-dialog" style={{top:photoSourcePosition.top,left:photoSourcePosition.left,width:photoSourcePosition.width}} role="dialog" aria-modal="true" aria-label="Choisir une source de photo" onClick={e=>e.stopPropagation()}><button type="button" className="photo-source-option" onClick={()=>{setPhotoSourceOpen(false);filesPhotoInput.current?.click();}}><Icon name="image" size={18}/><span>Choisir dans les fichiers</span></button><button type="button" className="photo-source-option" onClick={()=>{setPhotoSourceOpen(false);cameraPhotoInput.current?.click();}}><Icon name="camera" size={18}/><span>Prendre une photo</span></button></section></div>,document.body)}
            {photoToCrop&&<PhotoCropper file={photoToCrop} onCancel={()=>setPhotoToCrop(null)} onConfirm={file=>{setProfilePhoto(file);setPhotoToCrop(null);setErrors(prev=>prev.filter(item=>item!=="profilePhoto"));}}/>}
          </Field>
        </div>}

        {errors.length > 0 && <p className="form-error" role="alert">Certains champs nécessitent ton attention. Vérifie les indications ci-dessus.</p>}
        {submitError && <div className="submit-notice" role="alert"><Icon name="info" /><div><b>Envoi impossible</b><p>{submitError}</p></div></div>}
        <div className="action-bar form-actions">
          <button className="button button-secondary" onClick={() => part > 0 ? setPart(p => p - 1) : go("presentation")}><Icon name="back" /> Retour</button>
          <button className="button button-primary" onClick={nextPart} disabled={submitting}>{submitting ? "Envoi en cours…" : canContinue ? "Continuer" : "Envoyer ma candidature"} {!submitting && <Icon name="arrow" />}</button>
        </div>
      </div>}

      {step === "confirmation" && <section className="confirmation-screen">
        <div className="success-icon"><Icon name="check" size={38} /></div>
        <span className="eyebrow">MASTERCLASS DESIGN</span>
        <h1>Ta candidature est bien reçue.</h1>
        <p>Merci {form.fullName.split(" ")[0] || ""}. Nous avons bien enregistré ta candidature à la Masterclass Design.</p>
        <p className="confirmation-followup">Pense à consulter régulièrement ta boîte e-mail, y compris tes courriers indésirables. Nous t’y communiquerons les informations concernant le suivi de ton dossier ainsi que la décision finale.</p>
        <div className="confirmation-card"><span>RÉCAPITULATIF</span><b>{form.fullName}</b><p>+243 {form.phone}</p></div>
        <button className="button button-secondary" onClick={() => go("home")}>Revenir à l’accueil</button>
      </section>}
      <footer className="site-foot">DÉPARTEMENT DESIGN · ÉGLISE DE LA COMPASSION · LUBUMBASHI</footer>
    </main>
  );
}

function Progress({ active }: { active: number }) {
  return <div className="top-progress"><span className="done" /><span className={active >= 0 ? "current" : ""} /><span className={active >= 1 ? "current" : ""} /></div>;
}
function Info({ icon, label, value }: { icon: string; label: string; value: string }) {
  return <div className="info-item"><span className="info-icon"><Icon name={icon} size={21} /></span><div><small>{label}</small><b>{value}</b></div></div>;
}

function PhotoCropper({file,onCancel,onConfirm}:{file:File;onCancel:()=>void;onConfirm:(file:File)=>void}){
  const [source,setSource]=useState("");
  const [imageSize,setImageSize]=useState({width:0,height:0});
  const [frame,setFrame]=useState({width:0,height:0});
  const [crop,setCrop]=useState({x:0,y:0,size:0});
  const [processing,setProcessing]=useState(false);
  const interaction=useRef<{mode:"move"|"resize";corner:string;startX:number;startY:number;initial:{x:number;y:number;size:number}}|null>(null);
  useEffect(()=>{const url=URL.createObjectURL(file);setSource(url);return()=>URL.revokeObjectURL(url);},[file]);
  const loadImage=(event:React.SyntheticEvent<HTMLImageElement>)=>{
    const image=event.currentTarget;
    const availableWidth=Math.max(240,(image.closest(".photo-crop-workspace") as HTMLElement | null)?.clientWidth||360);
    const availableHeight=Math.max(260,Math.min(window.innerHeight*.48,420));
    const scale=Math.min(availableWidth/image.naturalWidth,availableHeight/image.naturalHeight,1);
    const width=Math.round(image.naturalWidth*scale),height=Math.round(image.naturalHeight*scale);
    setImageSize({width:image.naturalWidth,height:image.naturalHeight});
    setFrame({width,height});
    const size=Math.round(Math.min(width,height)*.78);
    setCrop({x:Math.round((width-size)/2),y:Math.round((height-size)/2),size});
  };
  const begin=(event:React.PointerEvent<HTMLElement>,mode:"move"|"resize",corner="")=>{
    event.preventDefault();event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    interaction.current={mode,corner,startX:event.clientX,startY:event.clientY,initial:{...crop}};
  };
  const move=(event:React.PointerEvent<HTMLElement>)=>{
    const active=interaction.current;if(!active)return;
    const dx=(event.clientX-active.startX),dy=(event.clientY-active.startY);
    if(active.mode==="move"){
      setCrop(p=>({...p,x:Math.max(0,Math.min(frame.width-p.size,active.initial.x+dx)),y:Math.max(0,Math.min(frame.height-p.size,active.initial.y+dy))}));
      return;
    }
    const {x,y,size}=active.initial,corner=active.corner;
    const signX=corner.includes("e")?1:-1,signY=corner.includes("s")?1:-1;
    const delta=(dx*signX+dy*signY)/2;
    const maxSize=Math.min(corner.includes("w")?x+size:frame.width-x,corner.includes("n")?y+size:frame.height-y);
    const nextSize=Math.max(56,Math.min(maxSize,size+delta));
    const nextX=corner.includes("w")?x+size-nextSize:x;
    const nextY=corner.includes("n")?y+size-nextSize:y;
    setCrop({x:nextX,y:nextY,size:nextSize});
  };
  const finish=()=>{interaction.current=null;};
  const confirm=async()=>{
    if(!source||!imageSize.width||!crop.size)return;
    setProcessing(true);
    try{
      const image=new Image();image.src=source;await image.decode();
      const scale=frame.width/image.naturalWidth;
      const sx=crop.x/scale,sy=crop.y/scale,sourceSize=crop.size/scale;
      const canvas=document.createElement("canvas");canvas.width=512;canvas.height=512;
      const context=canvas.getContext("2d");if(!context)throw new Error("Impossible de préparer cette image.");
      context.imageSmoothingEnabled=true;context.imageSmoothingQuality="high";
      context.drawImage(image,sx,sy,sourceSize,sourceSize,0,0,512,512);
      canvas.toBlob(blob=>{
        if(blob){const base=file.name.replace(/\.[^.]+$/,"")||"photo";onConfirm(new File([blob],base+"-recadree.jpg",{type:"image/jpeg",lastModified:Date.now()}));}
        else setProcessing(false);
      },"image/jpeg",.94);
    }catch{setProcessing(false);}
  };
  return <div className="photo-crop-overlay" onClick={onCancel}>
    <section className="photo-crop-dialog" role="dialog" aria-modal="true" aria-label="Recadrer la photo" onClick={e=>e.stopPropagation()}>
      <header className="photo-crop-header"><div><span className="photo-dialog-kicker">PHOTO DE PROFIL</span><h3>Recadrer la photo</h3><p>Déplace le carré et ajuste ses poignées pour sélectionner la partie à conserver.</p></div><button type="button" onClick={onCancel} aria-label="Fermer">×</button></header>
      <div className="photo-crop-workspace">
        <div className="photo-crop-image-stage" style={{width:frame.width||"auto",height:frame.height||"auto"}}>
          {source&&<img className="photo-crop-source-image" src={source} alt="Photo originale à recadrer" draggable={false} onLoad={loadImage} style={{width:frame.width||"auto",height:frame.height||"auto"}}/>}
          {frame.width>0&&<div className="photo-selection-square" style={{left:crop.x,top:crop.y,width:crop.size,height:crop.size}} onPointerDown={e=>begin(e,"move")} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
            <span className="photo-crop-shade photo-crop-shade-top"/><span className="photo-crop-shade photo-crop-shade-bottom"/><span className="photo-crop-shade photo-crop-shade-left"/><span className="photo-crop-shade photo-crop-shade-right"/>
            <span className="photo-crop-gridline horizontal one"/><span className="photo-crop-gridline horizontal two"/><span className="photo-crop-gridline vertical one"/><span className="photo-crop-gridline vertical two"/>
            {["nw","ne","sw","se"].map(corner=><button key={corner} type="button" className={"photo-crop-handle "+corner} aria-label={"Redimensionner le cadre "+corner} onPointerDown={e=>begin(e,"resize",corner)} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}/>)}
          </div>}
        </div>
        <span className="photo-crop-tip">Fais glisser le carré pour le déplacer. Tire ses coins pour le redimensionner.</span>
      </div>
      <footer className="photo-crop-actions"><button type="button" className="photo-cancel" onClick={onCancel}>Annuler</button><button type="button" className="photo-confirm" onClick={()=>void confirm()} disabled={!imageSize.width||processing}>{processing?"Préparation…":"Valider le recadrage"}</button></footer>
    </section>
  </div>;
}

function fieldHasAnswer(node: React.ReactNode): boolean {
  return Children.toArray(node).some(child => {
    if (!isValidElement(child)) return false;
    const props = child.props as { value?: unknown; checked?: boolean; children?: React.ReactNode };
    if (typeof props.value === "string" && props.value.trim() !== "") return true;
    if (typeof props.value === "boolean" && props.value) return true;
    if (props.checked === true) return true;
    return props.children ? fieldHasAnswer(props.children) : false;
  });
}
function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  const answered = fieldHasAnswer(children);
  const stateClass = error ? " field-invalid" : answered ? " field-answered" : "";
  return <div className={"field"+stateClass}><label className="field-label">{label}</label>{children}<div className="field-meta">{error ? <span className="field-error">{error}</span> : <span>{hint || " "}</span>}</div></div>;
}
function Dropdown({value,onChange,options,placeholder}:{value:string;onChange:(value:string)=>void;options:string[];placeholder:string}){
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open)return;
    const close=(event:PointerEvent)=>{if(root.current&&!root.current.contains(event.target as Node))setOpen(false);};
    const key=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false);};
    document.addEventListener("pointerdown",close);document.addEventListener("keydown",key);
    return()=>{document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",key);};
  },[open]);
  return <div className={"form-dropdown"+(open?" is-open":"")} ref={root}>
    <button type="button" className="form-dropdown-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>
      <span className={value?"":"is-placeholder"}>{value||placeholder}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>
    </button>
    {open&&<div className="form-dropdown-menu" role="listbox">{options.map(option=><button type="button" role="option" aria-selected={value===option} key={option} className={"form-dropdown-option"+(value===option?" selected":"")} onClick={()=>{onChange(option);setOpen(false);}}>{option}{value===option&&<span aria-hidden="true">✓</span>}</button>)}</div>}
  </div>;
}

function Choice({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[] }) {
  return <div className="choice-group">{options.map(option => <button type="button" key={option} className={value === option ? "choice selected" : "choice"} onClick={() => onChange(option)}>{option}</button>)}</div>;
}
function Notice({ children }: { children: React.ReactNode }) {
  return <div className="inline-notice"><Icon name="info" size={19} /><p>{children}</p></div>;
}

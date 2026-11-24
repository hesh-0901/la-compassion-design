import { useEffect, useMemo, useState } from "react";

type Step = "home" | "presentation" | "registration" | "confirmation";
type FormData = {
  fullName: string; phone: string; email: string; area: string; age: string;
  member: string; extension: string; attendance: string; department: string; maturity: string; level: string; tools: string[];
  portfolio: string; ram: string; availability: string; motivation: string; commitment: boolean;
};
const initialForm: FormData = {
  fullName: "", phone: "", email: "", area: "", age: "", member: "", attendance: "",
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
    return "home";
  });
  const [form, setForm] = useState<FormData>(initialForm);
  const [part, setPart] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [showMemberNotice, setShowMemberNotice] = useState(false);
  const [showRamNotice, setShowRamNotice] = useState(false);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [portfolioFile, setPortfolioFile] = useState<File | null>(null);
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);

  const go = (next: Step) => {
    setStep(next);
    const path = next === "home" ? "/" : next === "presentation" ? "/presentation" : next === "registration" ? "/inscription" : "/confirmation";
    window.history.pushState({ step: next }, "", path);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname;
      setStep(path.startsWith("/presentation") ? "presentation" : path.startsWith("/inscription") ? "registration" : path.startsWith("/confirmation") ? "confirmation" : "home");
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
      ? ["fullName", "phone", "area", "age"]
      : part === 1 ? ["member", "extension", "attendance", "department", "maturity", "level"]
      : ["ram", "availability", "motivation", "commitment"];
    const missing = required.filter(key => {
      const value = form[key];
      return typeof value === "string" ? !value.trim() : typeof value === "boolean" ? !value : false;
    }).map(String);
    if (part === 0 && phoneDigits.length !== 9) missing.push("phone");
    if (part === 2 && !profilePhoto) missing.push("profilePhoto");
    setErrors(missing);
    return missing.length === 0;
  };
  const nextPart = () => {
    if (!validate()) return;
    if (part < 2) { setPart(p => p + 1); window.scrollTo({ top: 0, behavior: "smooth" }); }
    else setShowUnavailable(true);
  };
  const canContinue = useMemo(() => part < 2, [part]);

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      {step === "home" && <section className="home-screen">
        <div className="poster-frame">
          <img className="poster" src="/images/masterclass-design.png" alt="Masterclass Design, intensive et pratique, du 15 au 19 décembre 2026, de 19h à 22h." />
        </div>
        <h1 className="home-question">Souhaites-tu participer à la Masterclass Design&nbsp;?</h1>
        <button className="button button-primary home-button" onClick={() => go("presentation")}>J’accepte <Icon name="arrow" size={21} /></button>
      </section>}

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
        <div className="places-strip"><span className="place-dot" /> Les places sont limitées. Les candidatures seront étudiées par l’équipe.</div>
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
        <div className="action-bar"><button className="button button-primary" onClick={() => { setPart(0); go("registration"); }}>Je veux candidater <Icon name="arrow" /></button></div>
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
          <Field label="Numéro WhatsApp" error={errors.includes("phone") ? "Le numéro doit contenir 9 chiffres après +243." : ""}><div className="phone-input"><span>+243</span><input inputMode="numeric" autoComplete="tel-national" value={form.phone} onChange={e => update("phone", e.target.value.replace(/\D/g, "").slice(0, 9))} placeholder="81 234 56 78" /></div></Field>
          <Field label="Adresse e-mail" hint="Facultatif"><input type="email" autoComplete="email" value={form.email} onChange={e => update("email", e.target.value)} placeholder="nom@exemple.com" /></Field>
          <Field label="Commune ou quartier" error={errors.includes("area") ? "Précise ta commune ou ton quartier." : ""}><input autoComplete="address-level2" value={form.area} onChange={e => update("area", e.target.value)} placeholder="Ex. Lubumbashi, Golf" /></Field>
          <Field label="Tranche d’âge" error={errors.includes("age") ? "Choisis une tranche d’âge." : ""}><Choice value={form.age} onChange={v => update("age", v)} options={["Moins de 18 ans", "18–24 ans", "25–34 ans", "35 ans et plus"]} /></Field>
        </div>}

        {part === 1 && <div className="fields">
          <Field label="Es-tu membre de l’Église de la Compassion ?" error={errors.includes("member") ? "Choisis une réponse." : ""}><Choice value={form.member} onChange={v => { update("member", v); setShowMemberNotice(v === "Non"); }} options={["Oui", "Non"]} /></Field>
          {showMemberNotice && <Notice>Cette masterclass est réservée aux membres de l’Église de la Compassion. Tu peux contacter le département Design pour plus d’informations.</Notice>}
          <Field label="Depuis quand fréquentes-tu l’église ?" error={errors.includes("attendance") ? "Précise depuis quand." : ""}><select value={form.attendance} onChange={e => update("attendance", e.target.value)}><option value="">Sélectionner</option><option>Moins d’un an</option><option>1 à 3 ans</option><option>3 à 5 ans</option><option>Plus de 5 ans</option></select></Field>
          <Field label="Dans quelle extension es-tu ?" error={errors.includes("extension") ? "Choisis ton extension." : ""}><Choice value={form.extension} onChange={v => update("extension", v)} options={["Ville (centrale)", "Golf plateau 1", "Kimbeimbe", "Tabac Congo", "Golf Faustin"]} /></Field>
          <Field label="Dans quel département sers-tu ?" error={errors.includes("department") ? "Choisis ton département." : ""}><Choice value={form.department} onChange={v => update("department", v)} options={["Presse", "Chorale", "Accueil", "Intercession", "Ecodim", "Aucun", "Autres"]} /></Field>
          <Field label="Quel est ton niveau d’affermissement ?" error={errors.includes("maturity") ? "Choisis ton niveau d’affermissement." : ""}><Choice value={form.maturity} onChange={v => update("maturity", v)} options={["Niveau 1", "Niveau 2", "Niveau 3", "Niveau 4", "Non affermi", "Affermi"]} /></Field>
          <Field label="Ton niveau actuel en design" error={errors.includes("level") ? "Choisis ton niveau." : ""}><Choice value={form.level} onChange={v => update("level", v)} options={["Débutant", "Intermédiaire", "Avancé"]} /></Field>
          <Field label="Quels outils as-tu déjà utilisés ?" hint="Plusieurs choix possibles"><div className="chip-list">{["Canva", "Photoshop", "Illustrator", "Figma", "Autre"].map(tool => <button type="button" key={tool} className={form.tools.includes(tool) ? "chip selected" : "chip"} onClick={() => update("tools", form.tools.includes(tool) ? form.tools.filter(x => x !== tool) : [...form.tools, tool])}>{form.tools.includes(tool) && <Icon name="check" size={14} />}{tool}</button>)}</div></Field>
          <Field label="As-tu un lien ou un fichier d’une création déjà réalisée ?" hint="Facultatif — lien ou fichier"><input type="url" value={form.portfolio} onChange={e => update("portfolio", e.target.value)} placeholder="Colle un lien (facultatif)" /><input className="file-input" type="file" accept="image/*,.pdf,.psd,.ai,.svg" onChange={e => setPortfolioFile(e.target.files?.[0] || null)} /><span className="file-hint">{portfolioFile ? portfolioFile.name : "Ajouter un fichier (image, PDF, PSD, AI ou SVG)"}</span></Field>
        </div>}

        {part === 2 && <div className="fields">
          <Field label="Ton ordinateur a-t-il au moins 8 Go de RAM ?" error={errors.includes("ram") ? "Choisis une réponse." : ""}><Choice value={form.ram} onChange={v => { update("ram", v); setShowRamNotice(v === "Non"); }} options={["Oui", "Non", "Je ne sais pas"]} /></Field>
          {showRamNotice && <Notice>Un ordinateur avec au moins 8 Go de RAM est nécessaire pour suivre les exercices pratiques. Tu peux vérifier cette information dans les paramètres de ton appareil.</Notice>}
          <Field label="Seras-tu disponible du 15 au 19 décembre, de 19h à 22h ?" error={errors.includes("availability") ? "Indique ta disponibilité." : ""}><Choice value={form.availability} onChange={v => update("availability", v)} options={["Oui", "Partiellement"]} /></Field>
          <Field label="Pourquoi veux-tu suivre cette Masterclass ?" error={errors.includes("motivation") ? "Choisis une motivation." : ""}><Choice value={form.motivation} onChange={v => update("motivation", v)} options={["Me cultiver", "Rejoindre le département Design", "Contribuer aux créations visuelles de mon département", "Autres"]} /></Field>
          <label className={errors.includes("commitment") ? "commitment-check invalid" : "commitment-check"}><input type="checkbox" checked={form.commitment} onChange={e => update("commitment", e.target.checked)} /><span>Je m’engage à rejoindre le département Design après la formation.</span></label>
          {errors.includes("commitment") && <p className="field-error">Confirme ton engagement pour continuer.</p>}
          <Field label="Ajoute une photo de profil" error={errors.includes("profilePhoto") ? "Ta photo de profil est requise." : ""} hint="Photo nette, de préférence un portrait"><input className="file-input" type="file" accept="image/*" capture="user" onChange={e => setProfilePhoto(e.target.files?.[0] || null)} /><span className="file-hint">{profilePhoto ? profilePhoto.name : "Choisir une photo de profil"}</span></Field>
        </div>}

        {errors.length > 0 && <p className="form-error" role="alert">Certains champs nécessitent ton attention. Vérifie les indications ci-dessus.</p>}
        {showUnavailable && <div className="submit-notice" role="status"><Icon name="info" /><div><b>Envoi en ligne non activé</b><p>Le formulaire est prêt côté interface, mais la connexion sécurisée au serveur n’est pas encore configurée. Aucune candidature n’a été transmise.</p></div></div>}
        <div className="action-bar form-actions">
          <button className="button button-secondary" onClick={() => part > 0 ? setPart(p => p - 1) : go("presentation")}><Icon name="back" /> Retour</button>
          <button className="button button-primary" onClick={nextPart}>{canContinue ? "Continuer" : "Envoyer ma candidature"} <Icon name="arrow" /></button>
        </div>
      </div>}

      {step === "confirmation" && <section className="confirmation-screen">
        <div className="success-icon"><Icon name="check" size={38} /></div>
        <span className="eyebrow">MASTERCLASS DESIGN</span>
        <h1>Ta candidature est bien reçue.</h1>
        <p>Merci {form.fullName.split(" ")[0] || ""}. Nous avons bien enregistré ta candidature à la Masterclass Design.</p>
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
function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return <div className="field"><label className="field-label">{label}</label>{children}<div className="field-meta">{error ? <span className="field-error">{error}</span> : <span>{hint || " "}</span>}</div></div>;
}
function Choice({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[] }) {
  return <div className="choice-group">{options.map(option => <button type="button" key={option} className={value === option ? "choice selected" : "choice"} onClick={() => onChange(option)}>{option}</button>)}</div>;
}
function Notice({ children }: { children: React.ReactNode }) {
  return <div className="inline-notice"><Icon name="info" size={19} /><p>{children}</p></div>;
}

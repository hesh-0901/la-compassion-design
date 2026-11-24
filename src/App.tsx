import { useState } from "react";

export default function App() {
  const [accepted, setAccepted] = useState(false);

  return (
    <main className="welcome-screen">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <div className="light-streak" aria-hidden="true" />

      <header className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="brand-copy">
          <span className="brand-name">LA COMPASSION</span>
          <span className="brand-city">LUBUMBASHI</span>
        </div>
        <div className="department">DÉPARTEMENT<br /><strong>DE DESIGN</strong></div>
      </header>

      <section className="welcome-content" aria-labelledby="page-title">
        <p className="eyebrow">CRÉATIVITÉ · TECHNIQUE · EXCELLENCE</p>
        <h1 id="page-title">
          <span>MASTER</span>
          <span>CLASS</span>
          <em>DESIGN</em>
        </h1>
        <p className="welcome-caption">INTENSIVE ET PRATIQUE</p>

        <button
          className={`accept-button ${accepted ? "is-accepted" : ""}`}
          type="button"
          onClick={() => setAccepted(true)}
          aria-live="polite"
        >
          <span>{accepted ? "Bienvenue à la Masterclass" : "J’accepte"}</span>
          <span className="button-arrow" aria-hidden="true">↗</span>
        </button>
        <p className="micro-copy">
          {accepted
            ? "La suite de l’inscription sera bientôt disponible."
            : "Une formation créative au sein de La Compassion"}
        </p>
      </section>

      <div className="bottom-glow" aria-hidden="true" />
    </main>
  );
}
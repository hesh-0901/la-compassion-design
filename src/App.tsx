import { useState } from "react";

export default function App() {
  const [accepted, setAccepted] = useState(false);

  return (
    <main className="welcome-screen">
      <section className="welcome-panel" aria-label="Masterclass Design">
        <img
          className="masterclass-poster"
          src="/images/masterclass-design.png"
          alt="Affiche de la Masterclass Design — La Compassion Lubumbashi"
        />
        <h1 className="welcome-question">
          Souhaites-tu participer à la Masterclass Design ?
        </h1>
        <button
          className="accept-button"
          type="button"
          onClick={() => setAccepted(true)}
          aria-live="polite"
        >
          {accepted ? "J’accepte ✓" : "J’accepte"}
          <span className="button-arrow" aria-hidden="true">↗</span>
        </button>
      </section>
    </main>
  );
}
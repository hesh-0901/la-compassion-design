export default function App() {
  return (
    <main className="welcome-screen">
      <section className="welcome-panel" aria-label="Inscription à la Masterclass Design">
        <img
          className="masterclass-poster"
          src="/images/masterclass-design.jpg"
          alt="Affiche de la Masterclass Design — La Compassion Lubumbashi"
        />
        <h1 className="welcome-question">
          Souhaitez-vous participer à la Masterclass Design ?
        </h1>
        <button className="accept-button" type="button">
          J’accepte
          <span className="button-arrow" aria-hidden="true">↗</span>
        </button>
      </section>
    </main>
  );
}
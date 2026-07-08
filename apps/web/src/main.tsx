import React from "react";
import ReactDOM from "react-dom/client";
import { Activity, Battery, MapPin, Radio, ShieldCheck, Wifi } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import "./styles.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

type Bootstrap = {
  workspace_id: string | null;
  workspace_name: string;
  api_host: string;
  mqtt_host: string;
  mqtt_port: number;
  stream_rtmp_url_template: string;
  docs_url: string;
  todo: string;
};

const metrics = [
  { label: "Drones simultaneos", value: "0 / 2", icon: Radio },
  { label: "Gateway DJI", value: "Offline", icon: Wifi },
  { label: "Bateria media", value: "--", icon: Battery },
  { label: "Ocorrencia ativa", value: "Nenhuma", icon: Activity },
];

function useHostMode() {
  return window.location.hostname.startsWith("pilot.") ? "pilot" : "ops";
}

function App() {
  const mode = useHostMode();
  return mode === "pilot" ? <PilotPage /> : <OpsDashboard />;
}

function OpsDashboard() {
  const reduceMotion = useReducedMotion();

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Navegacao principal">
        <div className="brand-lockup">
          <div className="brand-mark">UAS</div>
          <div>
            <strong>UAS Platform</strong>
            <span>AHBVC Drone OPS</span>
          </div>
        </div>
        <nav>
          <a className="nav-link active" href="/">
            Operacoes
          </a>
          <a className="nav-link" href="/pilot">
            Pilot 2
          </a>
          <a className="nav-link" href="/docs">
            Configuracao
          </a>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Bombeiros Voluntarios de Cascais</p>
            <h1>Consola inicial de operacoes UAS</h1>
          </div>
          <span className="status-pill offline">Sem telemetria</span>
        </header>

        <motion.section
          className="metric-grid"
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
        >
          {metrics.map((metric) => (
            <article className="metric-card" key={metric.label}>
              <metric.icon aria-hidden="true" size={20} />
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </article>
          ))}
        </motion.section>

        <section className="ops-grid">
          <article className="map-panel" aria-label="Mapa operacional">
            <div className="map-grid">
              <div className="map-crosshair">
                <MapPin aria-hidden="true" size={28} />
              </div>
            </div>
            <div className="map-footer">
              <strong>Mapa em tempo real</strong>
              <span>MapLibre sera ativado na Fase 4 apos receber telemetria MQTT.</span>
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <ShieldCheck aria-hidden="true" size={20} />
              <h2>Gateways e drones</h2>
            </div>
            <dl className="definition-list">
              <div>
                <dt>DJI Matrice 30T</dt>
                <dd>A aguardar registo via Pilot 2</dd>
              </div>
              <div>
                <dt>DJI Matrice 4T</dt>
                <dd>A aguardar registo via Pilot 2</dd>
              </div>
              <div>
                <dt>MQTT</dt>
                <dd>EMQX preparado para topicos DJI Cloud API</dd>
              </div>
            </dl>
          </article>
        </section>
      </section>
    </main>
  );
}

function PilotPage() {
  const [bootstrap, setBootstrap] = React.useState<Bootstrap | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch(`${apiBaseUrl}/api/v1/dji/pilot/bootstrap`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<Bootstrap>;
      })
      .then(setBootstrap)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main className="pilot-page">
      <section className="pilot-card" aria-labelledby="pilot-title">
        <p className="eyebrow">DJI Pilot 2 Open Platform</p>
        <h1 id="pilot-title">UAS Platform</h1>
        <p className="intro">
          Portal tecnico para validar a ligacao do DJI Pilot 2 aos servicos Cloud API da AHBVC.
        </p>

        <div className="config-list" aria-live="polite">
          {error ? <p className="error-text">API indisponivel: {error}</p> : null}
          {bootstrap ? (
            <>
              <ConfigRow label="Workspace" value={bootstrap.workspace_name} />
              <ConfigRow label="API" value={bootstrap.api_host} />
              <ConfigRow label="MQTT TLS" value={`${bootstrap.mqtt_host}:${bootstrap.mqtt_port}`} />
              <ConfigRow label="RTMP" value={bootstrap.stream_rtmp_url_template} />
            </>
          ) : (
            <p>A carregar configuracao...</p>
          )}
        </div>

        <form className="pilot-form">
          <label>
            Utilizador Pilot
            <input autoComplete="username" name="username" type="text" />
          </label>
          <label>
            Palavra-passe
            <input autoComplete="current-password" name="password" type="password" />
          </label>
          <button type="button">Validar depois da configuracao DJI</button>
        </form>
      </section>
    </main>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="config-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);


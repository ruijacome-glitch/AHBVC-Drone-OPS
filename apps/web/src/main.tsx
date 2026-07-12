import React from "react";
import ReactDOM from "react-dom/client";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Database,
  History,
  MapPin,
  Moon,
  Play,
  Radio,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Square,
  Sun,
  Thermometer,
  Video,
  Wifi,
  XCircle,
  ZoomIn,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import maplibregl from "maplibre-gl";

import "./styles.css";
import "maplibre-gl/dist/maplibre-gl.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

type Theme = "light" | "dark";

function preferredTheme(): Theme {
  const saved = window.localStorage.getItem("uas:theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const initialTheme = preferredTheme();
document.documentElement.dataset.theme = initialTheme;

type JsBridgeConfig = {
  setup_ready: boolean;
  missing_config: string[];
  app_id: string | null;
  app_key: string | null;
  app_basic_license: string | null;
  workspace_id: string | null;
  workspace_name: string;
  platform_name: string;
  platform_description: string;
  api_host: string;
  api_token: string | null;
  mqtt_url: string;
  mqtt_username: string | null;
  mqtt_password: string | null;
  ws_host: string | null;
  stream_rtmp_url_template: string;
  docs_url: string;
  todo: string;
};

type BridgeResult = {
  code: number;
  message?: string;
  data?: unknown;
};

type MqttStatus = {
  connected: boolean;
  devices: Record<string, { message_count: number; last_message_at?: string | null }>;
};

type DashboardSummary = {
  counters: {
    active_occurrences: number;
    active_missions: number;
    flights_today: number;
    total_flights: number;
    active_streams: number;
  };
  services: { api: boolean; database: boolean; mqtt: boolean };
  activity: Array<{
    activity_type: "occurrence" | "flight" | "stream";
    title: string;
    detail: string;
    occurred_at: string;
  }>;
  generated_at: string;
};

type LivestreamOption = {
  gateway_sn: string;
  aircraft_sn: string;
  camera_index: string;
  video_index: string;
  video_type: string;
  video_id: string;
};

type Telemetry = {
  drone_serial: string;
  gateway_serial: string;
  model: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude_m: number | null;
  speed_mps: number | null;
  heading_deg: number | null;
  pitch_deg?: number | null;
  roll_deg?: number | null;
  yaw_deg?: number | null;
  battery_percent: number | null;
  gps_status: string | null;
  rtk_status: string | null;
  active_payload: string | null;
  flight_mode: string | null;
  link_quality?: string | null;
  observed_at: string;
};

type FlightTrack = {
  geometry: { type: "LineString"; coordinates: [number, number, number][] };
  started_at: string;
  ended_at: string | null;
};

type DjiBridge = {
  platformVerifyLicense?: (appId: string, appKey: string, license: string) => string | void;
  platformSetWorkspaceId?: (uuid: string) => string | void;
  platformSetInformation?: (
    platformName: string,
    workspaceName: string,
    description: string,
  ) => string | void;
  platformLoadComponent?: (name: string, param: string) => string | void;
  platformIsComponentLoaded?: (name: string) => string | boolean;
  thingConnect?: (username: string, password: string, callback: string) => string | void;
  thingSetConnectCallback?: (callback: string) => string | void;
  thingGetConnectState?: () => boolean | string | number | Record<string, unknown>;
  thingGetConfigs?: () => string;
  apiSetToken?: (token: string) => string | void;
  platformGetRemoteControllerSN?: () => string;
  platformGetAircraftSN?: () => string;
};

function parseConnectState(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "connected", "success"].includes(normalized)) return true;
    if (["false", "0", "disconnected", "failed"].includes(normalized)) return false;
    try {
      return parseConnectState(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (value && typeof value === "object") {
    const response = value as Record<string, unknown>;
    if ("data" in response) return parseConnectState(response.data);
    if ("connected" in response) return parseConnectState(response.connected);
  }
  return undefined;
}

function parseBridgeData<T>(value: string | undefined): T | undefined {
  if (!value) return undefined;
  try {
    const response = JSON.parse(value) as { code?: number; data?: T };
    return response.code === 0 ? response.data : undefined;
  } catch {
    return undefined;
  }
}

async function getBackendMqttStatus(): Promise<MqttStatus | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/dji/mqtt/status`, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as MqttStatus;
  } catch {
    return null;
  }
}

declare global {
  interface Window {
    djiBridge?: DjiBridge;
    uasPilotBridgeThingCallback?: (payload: string | boolean) => void;
    connectCallback?: (payload: string | boolean) => void;
    liveStatusCallback?: (payload: string) => void;
  }
}

type StepStatus = "pending" | "running" | "ok" | "error" | "skipped";

type SetupStep = {
  id: string;
  label: string;
  status: StepStatus;
  detail: string;
};

const setupSteps: SetupStep[] = [
  {
    id: "license",
    label: "Verificar licenca Cloud API",
    status: "pending",
    detail: "A aguardar DJI Pilot 2 JSBridge.",
  },
  {
    id: "workspace",
    label: "Definir workspace",
    status: "pending",
    detail: "Workspace UUID enviado para o Pilot.",
  },
  {
    id: "platform",
    label: "Publicar informacao da plataforma",
    status: "pending",
    detail: "Nome e descricao visiveis no portal Cloud Services.",
  },
  {
    id: "api",
    label: "Carregar modulo API",
    status: "pending",
    detail: "HTTPS com X-Auth-Token para endpoints Pilot to Cloud.",
  },
  {
    id: "thing",
    label: "Carregar modulo MQTT",
    status: "pending",
    detail: "Ligacao thing ao EMQX para telemetria.",
  },
  {
    id: "liveshare",
    label: "Carregar modulo livestream",
    status: "pending",
    detail: "Capacidades de livestream e video_id do gateway DJI.",
  },
  {
    id: "tsa",
    label: "TSA via WebSocket",
    status: "pending",
    detail: "Pendente ate implementarmos o modulo ws.",
  },
];

function useHostMode() {
  return window.location.hostname.startsWith("pilot.") ? "pilot" : "ops";
}

function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = React.useState<Theme>(initialTheme);
  const nextTheme = theme === "dark" ? "light" : "dark";

  function toggleTheme() {
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("uas:theme", nextTheme);
  }

  return (
    <motion.button
      className={`theme-toggle ${compact ? "compact" : ""}`}
      type="button"
      onClick={toggleTheme}
      whileTap={{ scale: 0.97 }}
      aria-label={`Ativar modo ${nextTheme === "dark" ? "escuro" : "claro"}`}
      title={`Ativar modo ${nextTheme === "dark" ? "escuro" : "claro"}`}
    >
      <span className="theme-toggle-icon" aria-hidden="true">{theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}</span>
      {!compact ? <span><strong>{theme === "dark" ? "Modo escuro" : "Modo claro"}</strong><small>Alterar aparência</small></span> : null}
    </motion.button>
  );
}

function App() {
  const mode = useHostMode();
  if (mode === "pilot") return <PilotPage />;
  if (window.location.pathname === "/stream") return <LiveStreamPage />;
  return window.location.pathname === "/history" ? <FlightHistoryPage /> : <OpsDashboard />;
}

function OpsDashboard() {
  const reduceMotion = useReducedMotion();
  const [summary, setSummary] = React.useState<DashboardSummary | null>(null);
  const [statusLoading, setStatusLoading] = React.useState(true);
  const [refreshError, setRefreshError] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/dashboard/summary`, { cache: "no-store" });
        if (!response.ok) throw new Error("Dashboard indisponível");
        if (!active) return;
        setSummary((await response.json()) as DashboardSummary);
        setRefreshError(false);
      } catch {
        if (active) setRefreshError(true);
      } finally {
        if (active) setStatusLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const servicesOnline = summary
    ? Object.values(summary.services).filter(Boolean).length
    : 0;
  const platformOnline = servicesOnline === 3 && !refreshError;
  const metrics = [
    { label: "Ocorrências ativas", value: summary?.counters.active_occurrences ?? 0, detail: "Resposta operacional", icon: ShieldAlert },
    { label: "Missões em curso", value: summary?.counters.active_missions ?? 0, detail: "Operações associadas", icon: Activity },
    { label: "Voos hoje", value: summary?.counters.flights_today ?? 0, detail: "Desde as 00:00 UTC", icon: Radio },
    { label: "Voos registados", value: summary?.counters.total_flights ?? 0, detail: "Histórico da plataforma", icon: History },
  ];
  const services = [
    { label: "API operacional", description: "FastAPI e endpoints públicos", online: summary?.services.api, icon: Server },
    { label: "Base de dados", description: "PostgreSQL e PostGIS", online: summary?.services.database, icon: Database },
    { label: "Mensageria", description: "Ligação interna ao EMQX", online: summary?.services.mqtt, icon: Wifi },
    { label: "Livestreams", description: summary?.counters.active_streams ? `${summary.counters.active_streams} transmissão ativa` : "Sem transmissão ativa", online: true, icon: Video },
  ];
  const quickActions = [
    { label: "Abrir livestream", detail: "Iniciar ou acompanhar vídeo", href: "/stream", icon: Video },
    { label: "Consultar voos", detail: "Rotas e telemetria histórica", href: "/history", icon: History },
    { label: "Configurar Pilot 2", detail: "Portal DJI Cloud Services", href: "/pilot", icon: Radio },
    { label: "Documentação", detail: "Estado e configuração técnica", href: "/docs", icon: ShieldCheck },
  ];

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
          <a className="nav-link" href="/history">
            Historico de voo
          </a>
          <a className="nav-link" href="/stream">
            Livestream
          </a>
          <a className="nav-link" href="/pilot">
            Pilot 2
          </a>
          <a className="nav-link" href="/docs">
            Configuracao
          </a>
        </nav>
        <ThemeToggle />
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Bombeiros Voluntários de Cascais</p>
            <h1>Centro de operações UAS</h1>
          </div>
          <span className={`status-pill ${statusLoading ? "checking" : platformOnline ? "online" : "offline"}`} aria-live="polite">
            {statusLoading ? "A verificar plataforma" : platformOnline ? "Plataforma operacional" : "Atenção necessária"}
          </span>
        </header>

        <motion.section
          className="dashboard-metrics"
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          aria-label="Resumo operacional"
        >
          {metrics.map((metric, index) => (
            <motion.article className="dashboard-metric" key={metric.label} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
              <div className="dashboard-metric-icon"><metric.icon aria-hidden="true" size={20} /></div>
              <span>{metric.label}</span><strong>{statusLoading ? "—" : metric.value}</strong><small>{metric.detail}</small>
            </motion.article>
          ))}
        </motion.section>

        <section className="dashboard-grid">
          <article className="panel dashboard-services">
            <div className="panel-heading"><ShieldCheck aria-hidden="true" size={20} /><div><h2>Estado da plataforma</h2><span>{servicesOnline} de 3 serviços essenciais disponíveis</span></div></div>
            <div className="service-list">
              {services.map((service) => (
                <div className="service-row" key={service.label}>
                  <div className="service-icon"><service.icon size={19} aria-hidden="true" /></div>
                  <div><strong>{service.label}</strong><span>{service.description}</span></div>
                  <span className={`service-state ${service.online ? "is-online" : "is-offline"}`}><span aria-hidden="true" />{service.online ? "Disponível" : "Indisponível"}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel dashboard-activity">
            <div className="panel-heading"><Clock3 aria-hidden="true" size={20} /><div><h2>Atividade recente</h2><span>Eventos operacionais agregados</span></div></div>
            <div className="activity-list">
              {summary?.activity.length ? summary.activity.map((item) => (
                <div className="activity-row" key={`${item.activity_type}-${item.occurred_at}`}>
                  <span className={`activity-marker ${item.activity_type}`} aria-hidden="true" />
                  <div><strong>{item.title}</strong><span>{item.detail}</span></div>
                  <time dateTime={item.occurred_at}>{new Date(item.occurred_at).toLocaleString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
                </div>
              )) : <div className="dashboard-empty"><Clock3 size={24} /><strong>Sem atividade registada</strong><span>Os próximos eventos operacionais aparecerão aqui.</span></div>}
            </div>
          </article>
        </section>

        <section className="dashboard-actions" aria-labelledby="quick-actions-title">
          <div className="section-heading"><div><p className="eyebrow">Acesso direto</p><h2 id="quick-actions-title">Ferramentas operacionais</h2></div></div>
          <div className="quick-action-grid">
            {quickActions.map((action) => (
              <motion.a className="quick-action" href={action.href} key={action.href} whileTap={{ scale: 0.985 }}>
                <action.icon size={21} aria-hidden="true" /><span><strong>{action.label}</strong><small>{action.detail}</small></span><ArrowRight size={18} aria-hidden="true" />
              </motion.a>
            ))}
          </div>
        </section>
        {refreshError ? <div className="dashboard-warning" role="status"><ShieldAlert size={18} /><span>Não foi possível atualizar o resumo. A apresentar a última informação disponível.</span></div> : null}
      </section>
    </main>
  );
}

type HistoricalTrack = FlightTrack & {
  id: string;
  point_count: number;
};

function FlightHistoryPage() {
  const [tracks, setTracks] = React.useState<HistoricalTrack[]>([]);
  const [selectedTrack, setSelectedTrack] = React.useState<HistoricalTrack | null>(null);
  const [telemetry, setTelemetry] = React.useState<Telemetry[]>([]);
  const droneSn = "1581F5BKP256200BF008";

  React.useEffect(() => {
    Promise.all([
      fetch(`${apiBaseUrl}/api/v1/dji/mqtt/telemetry/${droneSn}/tracks?limit=20`, { cache: "no-store" }),
      fetch(`${apiBaseUrl}/api/v1/dji/mqtt/telemetry/${droneSn}/history?limit=500`, { cache: "no-store" }),
    ])
      .then(async ([tracksResponse, telemetryResponse]) => {
        const history = tracksResponse.ok ? ((await tracksResponse.json()) as HistoricalTrack[]) : [];
        const points = telemetryResponse.ok ? ((await telemetryResponse.json()) as Telemetry[]) : [];
        setTracks(history);
        setSelectedTrack(history[0] ?? null);
        setTelemetry(points);
      })
      .catch(() => {
        setTracks([]);
        setTelemetry([]);
      });
  }, []);

  const selectedTelemetry = selectedTrack
    ? telemetry.filter((point) => {
        const time = new Date(point.observed_at).getTime();
        const start = new Date(selectedTrack.started_at).getTime();
        const end = selectedTrack.ended_at ? new Date(selectedTrack.ended_at).getTime() : Number.POSITIVE_INFINITY;
        return time >= start && time <= end;
      })
    : [];

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Navegacao principal">
        <div className="brand-lockup">
          <div className="brand-mark">UAS</div>
          <div><strong>UAS Platform</strong><span>AHBVC Drone OPS</span></div>
        </div>
        <nav>
          <a className="nav-link" href="/">Operacoes</a>
          <a className="nav-link active" href="/history">Historico de voo</a>
          <a className="nav-link" href="/stream">Livestream</a>
          <a className="nav-link" href="/pilot">Pilot 2</a>
        </nav>
        <ThemeToggle />
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Registos de operação</p>
            <h1>Histórico de voo</h1>
          </div>
          <span className="status-pill online">M30T</span>
        </header>
        <section className="history-layout">
          <div className="panel history-list" aria-label="Lista de voos">
            <div className="panel-heading"><Activity aria-hidden="true" size={20} /><h2>Voos registados</h2></div>
            {tracks.length === 0 ? <p className="empty-state">Ainda não existem rotas GPS registadas.</p> : null}
            {tracks.map((trackItem) => (
              <button
                className={`history-item ${selectedTrack?.id === trackItem.id ? "selected" : ""}`}
                key={trackItem.id}
                type="button"
                onClick={() => setSelectedTrack(trackItem)}
              >
                <strong>{new Date(trackItem.started_at).toLocaleString("pt-PT")}</strong>
                <span>{trackItem.point_count} pontos GPS</span>
                <span>{trackItem.ended_at ? "Concluído" : "Em curso"}</span>
              </button>
            ))}
          </div>
          <div className="history-map">
            {selectedTrack ? <TelemetryMap history={[]} track={selectedTrack} /> : <div className="map-empty"><MapPin size={28} /><strong>Selecione um voo</strong></div>}
          </div>
        </section>
        {selectedTrack ? <TelemetryCharts points={selectedTelemetry} /> : null}
      </section>
    </main>
  );
}

function LiveStreamPage() {
  const [options, setOptions] = React.useState<LivestreamOption[]>([]);
  const [selectedVideoId, setSelectedVideoId] = React.useState("");
  const [token, setToken] = React.useState<string | null>(null);
  const [quality, setQuality] = React.useState("0");
  const [streaming, setStreaming] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [sending, setSending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const selectedOption = options.find((option) => option.video_id === selectedVideoId) ?? options[0];
  const gatewaySn = selectedOption?.gateway_sn ?? "";
  const streamUrl = `https://stream.uas.ahbvc.org.pt/live/${gatewaySn}`;
  const hlsUrl = `${streamUrl}/index.m3u8`;

  const loadOptions = React.useCallback(async () => {
    try {
      const [configResponse, optionsResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/api/v1/dji/pilot/jsbridge-config`),
        fetch(`${apiBaseUrl}/api/v1/livestreams/options`),
      ]);
      if (!configResponse.ok || !optionsResponse.ok) throw new Error("Configuração indisponível");
      const config = (await configResponse.json()) as JsBridgeConfig;
      const result = (await optionsResponse.json()) as { options: LivestreamOption[] };
      setToken(config.api_token);
      setOptions(result.options);
      setSelectedVideoId((current) => current || result.options[0]?.video_id || "");
      setMessage(result.options.length ? null : "A aguardar as câmaras anunciadas pelo DJI Pilot 2.");
    } catch {
      setMessage("Não foi possível obter as câmaras disponíveis.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadOptions();
    const timer = window.setInterval(() => void loadOptions(), 10000);
    return () => window.clearInterval(timer);
  }, [loadOptions]);

  async function sendCommand(action: "start" | "stop") {
    if (!selectedOption || !token) {
      setMessage("A configuração DJI ainda não está pronta.");
      return;
    }
    setSending(true);
    setMessage(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/livestreams/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-token": token },
        body: JSON.stringify({
          gateway_sn: selectedOption.gateway_sn,
          video_id: selectedOption.video_id,
          ...(action === "start" ? { video_quality: Number(quality) } : {}),
        }),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Não foi possível enviar o comando DJI.");
      setStreaming(action === "start");
      setMessage(action === "start" ? "A iniciar vídeo no DJI Pilot 2..." : "Transmissão terminada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao controlar a transmissão.");
    } finally {
      setSending(false);
    }
  }

  const cameraLabel = (option: LivestreamOption) => ({
    wide: "Grande angular",
    zoom: "Zoom",
    thermal: "Térmica",
    normal: "Câmara FPV",
  }[option.video_type] ?? option.video_type);

  const CameraIcon = ({ type }: { type: string }) => type === "thermal" ? <Thermometer size={20} /> : type === "zoom" ? <ZoomIn size={20} /> : <Video size={20} />;

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Navegacao principal">
        <div className="brand-lockup"><div className="brand-mark">UAS</div><div><strong>UAS Platform</strong><span>AHBVC Drone OPS</span></div></div>
        <nav>
          <a className="nav-link" href="/">Operacoes</a>
          <a className="nav-link" href="/history">Historico de voo</a>
          <a className="nav-link active" href="/stream">Livestream</a>
          <a className="nav-link" href="/pilot">Pilot 2</a>
        </nav>
        <ThemeToggle />
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">Media operacional</p><h1>Livestream DJI</h1></div>
          <span className={`status-pill ${streaming ? "online" : "offline"}`}>{streaming ? "Comando activo" : "Parado"}</span>
        </header>
        <section className="stream-layout">
          <form className="panel stream-controls" onSubmit={(event) => { event.preventDefault(); void sendCommand("start"); }}>
            <div className="panel-heading stream-heading"><Radio aria-hidden="true" size={20} /><div><h2>Fonte de vídeo</h2><span>Selecione uma câmara disponível</span></div><button className="icon-action" type="button" onClick={() => void loadOptions()} aria-label="Atualizar câmaras" title="Atualizar câmaras"><RefreshCw size={18} /></button></div>
            <div className="camera-options" aria-label="Câmaras DJI disponíveis">
              {loading ? <div className="stream-empty"><CircleDashed className="spin" size={24} /><span>A detetar câmaras...</span></div> : options.map((option) => (
                <motion.button className={`camera-option ${selectedOption?.video_id === option.video_id ? "selected" : ""}`} key={option.video_id} type="button" onClick={() => setSelectedVideoId(option.video_id)} whileTap={{ scale: 0.98 }}>
                  <CameraIcon type={option.video_type} /><span><strong>{cameraLabel(option)}</strong><small>{option.aircraft_sn}</small></span><CheckCircle2 size={18} aria-hidden="true" />
                </motion.button>
              ))}
              {!loading && options.length === 0 ? <div className="stream-empty"><Video size={24} /><span>Nenhuma câmara anunciada</span></div> : null}
            </div>
            <label>Qualidade<select value={quality} onChange={(event) => setQuality(event.target.value)}><option value="0">Adaptativa</option><option value="1">Fluida</option><option value="2">SD</option><option value="3">HD</option><option value="4">UHD</option></select></label>
            <div className="stream-actions"><button className="primary-action" type="submit" disabled={!selectedOption || !token || sending}><Play size={18} />{sending ? "A enviar..." : "Iniciar stream"}</button><button className="secondary-action" type="button" disabled={!selectedOption || sending} onClick={() => void sendCommand("stop")}><Square size={16} />Parar</button></div>
            {message ? <p className="stream-message" role="status">{message}</p> : null}
            {gatewaySn ? <details className="stream-technical"><summary>Detalhes técnicos</summary><span>Gateway: {gatewaySn}</span><span>Video ID: {selectedOption?.video_id}</span><span>WebRTC: <a href={streamUrl} target="_blank" rel="noreferrer">abrir player</a></span><span>HLS: <a href={hlsUrl} target="_blank" rel="noreferrer">abrir playlist</a></span></details> : null}
          </form>
          <div className="stream-view panel">{streaming && gatewaySn ? <iframe key={streamUrl} title="DJI WebRTC livestream" src={streamUrl} allow="autoplay; fullscreen" /> : <div className="stream-placeholder"><Radio size={40} /><strong>Transmissão parada</strong><span>Escolha uma câmara e inicie o stream.</span></div>}</div>
        </section>
      </section>
    </main>
  );
}

type ChartSeries = { label: string; color: string; values: Array<number | null> };

function TelemetryCharts({ points }: { points: Telemetry[] }) {
  const ordered = points.slice().sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  const series: ChartSeries[] = [
    { label: "Altitude (m)", color: "#dc2626", values: ordered.map((point) => point.altitude_m) },
    { label: "Velocidade (m/s)", color: "#2563eb", values: ordered.map((point) => point.speed_mps) },
    { label: "Bateria (%)", color: "#15803d", values: ordered.map((point) => point.battery_percent) },
    { label: "Heading (graus)", color: "#9333ea", values: ordered.map((point) => point.heading_deg) },
    { label: "Yaw (graus)", color: "#0891b2", values: ordered.map((point) => point.yaw_deg ?? null) },
    { label: "Pitch / Roll (graus)", color: "#ea580c", values: ordered.map((point) => {
      if (point.pitch_deg == null && point.roll_deg == null) return null;
      return point.pitch_deg ?? point.roll_deg ?? null;
    }) },
  ];

  return (
    <section className="telemetry-history panel" aria-label="Graficos de telemetria">
      <div className="panel-heading">
        <Activity aria-hidden="true" size={20} />
        <div>
          <h2>Telemetria do voo</h2>
          <span className="chart-meta">{ordered.length} amostras guardadas</span>
        </div>
      </div>
      {ordered.length === 0 ? (
        <p className="empty-state">Não existem pontos de telemetria associados a este voo.</p>
      ) : (
        <>
          <div className="chart-grid">
            {series.map((item) => <TelemetryChart key={item.label} series={item} />)}
          </div>
          <TelemetryFacts point={ordered[ordered.length - 1]} />
        </>
      )}
    </section>
  );
}

function TelemetryFacts({ point }: { point: Telemetry }) {
  const facts = [
    ["Estado GPS", point.gps_status],
    ["Estado RTK", point.rtk_status],
    ["Payload activo", point.active_payload],
    ["Modo de voo", point.flight_mode],
    ["Qualidade da ligação", point.link_quality],
  ];
  return (
    <div className="telemetry-facts" aria-label="Estados de telemetria">
      {facts.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value ?? "--"}</strong>
        </div>
      ))}
    </div>
  );
}

function TelemetryChart({ series }: { series: ChartSeries }) {
  const valid = series.values.filter((value): value is number => value != null && Number.isFinite(value));
  if (valid.length === 0) {
    return <article className="chart-card"><strong>{series.label}</strong><span className="chart-empty">Sem dados</span></article>;
  }
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = Math.max(max - min, 1);
  const points = series.values.map((value, index) => {
    if (value == null) return null;
    const x = series.values.length === 1 ? 50 : (index / (series.values.length - 1)) * 100;
    const y = 92 - ((value - min) / range) * 78;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).filter(Boolean).join(" ");

  return (
    <article className="chart-card">
      <div className="chart-heading"><strong>{series.label}</strong><span>{min.toFixed(1)} - {max.toFixed(1)}</span></div>
      <svg className="telemetry-chart" viewBox="0 0 100 100" role="img" aria-label={series.label}>
        <line x1="0" y1="92" x2="100" y2="92" className="chart-axis" />
        <polyline points={points} style={{ stroke: series.color }} />
      </svg>
    </article>
  );
}

function TelemetryMap({ history, track }: { history: Telemetry[]; track: FlightTrack | null }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const markerRef = React.useRef<maplibregl.Marker | null>(null);
  const routeLayerRef = React.useRef(false);
  const validHistory = history.filter(
    (point) => point.latitude !== null && point.longitude !== null && (point.latitude !== 0 || point.longitude !== 0),
  );
  const routeCoordinates = track?.geometry.coordinates?.length
    ? track.geometry.coordinates.map(([longitude, latitude]) => [longitude, latitude] as [number, number])
    : validHistory
        .slice()
        .reverse()
        .flatMap((point) =>
          point.latitude !== null && point.longitude !== null
            ? [[point.longitude, point.latitude] as [number, number]]
            : [],
        );
  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: [`${apiBaseUrl}/api/v1/map/tiles/{z}/{x}/{y}.png`],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [-9.42, 38.7],
      zoom: 11,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.once("load", () => map.resize());
    mapRef.current = map;
    return () => {
      markerRef.current?.remove();
      map.remove();
      mapRef.current = null;
      routeLayerRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || routeCoordinates.length === 0) return;
    const latest = routeCoordinates[routeCoordinates.length - 1];
    if (!markerRef.current) {
      const element = document.createElement("div");
      element.className = "drone-marker";
      markerRef.current = new maplibregl.Marker({ element }).setLngLat(latest).addTo(map);
    } else {
      markerRef.current.setLngLat(latest);
    }
    map.easeTo({ center: latest, duration: 500 });
  }, [routeCoordinates]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || routeCoordinates.length < 2) return;
    const coordinates = routeCoordinates;
    const updateRoute = () => {
      map.resize();
      if (!map.getSource("flight-route")) {
        map.addSource("flight-route", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
        });
        map.addLayer({
          id: "flight-route-line",
          type: "line",
          source: "flight-route",
          paint: { "line-color": "#dc2626", "line-width": 4, "line-opacity": 0.85 },
        });
      }
      if (!map.getLayer("flight-route-line")) {
        map.addLayer({
          id: "flight-route-line",
          type: "line",
          source: "flight-route",
          paint: { "line-color": "#dc2626", "line-width": 4, "line-opacity": 0.85 },
        });
      }
      const source = map.getSource("flight-route") as maplibregl.GeoJSONSource;
      source.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } });
      routeLayerRef.current = true;
      const bounds = coordinates.reduce(
        (result, coordinate) => result.extend(coordinate),
        new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
      );
      map.fitBounds(bounds, { padding: 48, maxZoom: 17, duration: 0 });
    };
    if (map.isStyleLoaded()) updateRoute();
    else map.once("load", updateRoute);
    return () => {
      map.off("load", updateRoute);
    };
  }, [routeCoordinates]);

  return (
    <div className="map-grid maplibre-container">
      <div ref={containerRef} className="map-canvas" />
      {routeCoordinates.length === 0 ? (
        <div className="map-empty">
          <MapPin aria-hidden="true" size={28} />
          <strong>Posição GPS indisponível</strong>
          <span>A telemetria está a chegar; falta uma coordenada válida.</span>
        </div>
      ) : null}
    </div>
  );
}

function PilotPage() {
  const reduceMotion = useReducedMotion();
  const [config, setConfig] = React.useState<JsBridgeConfig | null>(null);
  const [steps, setSteps] = React.useState<SetupStep[]>(setupSteps);
  const [controllerSn, setControllerSn] = React.useState<string>("--");
  const [aircraftSn, setAircraftSn] = React.useState<string>("--");
  const [mqttState, setMqttState] = React.useState<"unknown" | "connected" | "disconnected">(
    "unknown",
  );
  const backendMqttConfirmed = React.useRef(false);
  const [isConfiguring, setIsConfiguring] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const connectCallback = (payload: string | boolean) => {
      const connected = parseConnectState(payload);
      if (connected === undefined) return;
      if (!connected && backendMqttConfirmed.current) return;
      setMqttState(connected ? "connected" : "disconnected");
      setStep(
        "thing",
        connected ? "ok" : "error",
        `Callback MQTT: ${String(payload)}`,
      );
    };
    window.connectCallback = connectCallback;
    window.uasPilotBridgeThingCallback = connectCallback;
    window.liveStatusCallback = (payload) => {
      console.info("DJI liveshare status", payload);
    };

    fetch(`${apiBaseUrl}/api/v1/dji/pilot/jsbridge-config`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<JsBridgeConfig>;
      })
      .then(setConfig)
      .catch((err: Error) => setError(err.message));
  }, []);

  function setStep(id: string, status: StepStatus, detail: string) {
    setSteps((current) =>
      current.map((step) => (step.id === id ? { ...step, status, detail } : step)),
    );
  }

  function bridgeCall(label: string, action: (bridge: DjiBridge) => string | void): BridgeResult {
    const bridge = window.djiBridge;
    if (!bridge) {
      throw new Error(`${label}: window.djiBridge indisponivel. Abre esta pagina dentro do DJI Pilot 2.`);
    }

    const raw = action(bridge);
    if (!raw) return { code: 0, message: "success" };

    try {
      return JSON.parse(raw) as BridgeResult;
    } catch {
      return { code: 0, message: raw };
    }
  }

  async function runPilotSetup() {
    if (!config) return;
    setError(null);
    setIsConfiguring(true);
    setSteps(setupSteps);
    backendMqttConfirmed.current = false;

    if (!config.setup_ready) {
      setError(`Configuracao incompleta no servidor: ${config.missing_config.join(", ")}`);
      setIsConfiguring(false);
      return;
    }

    try {
      setStep("license", "running", "A chamar platformVerifyLicense.");
      const licenseResult = bridgeCall("Licenca", (bridge) => {
        if (!bridge.platformVerifyLicense) {
          throw new Error("Metodo JSBridge indisponivel: platformVerifyLicense");
        }
        return bridge.platformVerifyLicense(
          config.app_id ?? "",
          config.app_key ?? "",
          config.app_basic_license ?? "",
        );
      });
      if (licenseResult.code !== 0) throw new Error(licenseResult.message ?? "Falha na licenca");
      setStep("license", "ok", licenseResult.message ?? "Licenca verificada.");

      setStep("workspace", "running", "A chamar platformSetWorkspaceId.");
      const workspaceResult = bridgeCall("Workspace", (bridge) => {
        if (!bridge.platformSetWorkspaceId) {
          throw new Error("Metodo JSBridge indisponivel: platformSetWorkspaceId");
        }
        return bridge.platformSetWorkspaceId(config.workspace_id ?? "");
      });
      if (workspaceResult.code !== 0) {
        throw new Error(workspaceResult.message ?? "Falha ao definir workspace");
      }
      setStep("workspace", "ok", config.workspace_id ?? "Workspace definido.");

      setStep("platform", "running", "A chamar platformSetInformation.");
      const platformResult = bridgeCall("Platform", (bridge) => {
        if (!bridge.platformSetInformation) {
          throw new Error("Metodo JSBridge indisponivel: platformSetInformation");
        }
        return bridge.platformSetInformation(
          config.platform_name,
          config.workspace_name,
          config.platform_description,
        );
      });
      if (platformResult.code !== 0) {
        throw new Error(platformResult.message ?? "Falha ao definir plataforma");
      }
      setStep("platform", "ok", `${config.platform_name} / ${config.workspace_name}`);

      setStep("api", "running", "A carregar API module.");
      const apiResult = bridgeCall("API module", (bridge) => {
        if (!bridge.platformLoadComponent) {
          throw new Error("Metodo JSBridge indisponivel: platformLoadComponent");
        }
        return bridge.platformLoadComponent(
          "api",
          JSON.stringify({ host: config.api_host, token: config.api_token }),
        );
      });
      if (apiResult.code !== 0) throw new Error(apiResult.message ?? "Falha no modulo API");
      bridgeCall("API token", (bridge) => {
        if (!bridge.apiSetToken) {
          throw new Error("Metodo JSBridge indisponivel: apiSetToken");
        }
        return bridge.apiSetToken(config.api_token ?? "");
      });
      setStep("api", "ok", config.api_host);

      setStep("thing", "running", "A carregar thing module e iniciar MQTT.");
      const thingLoaded = parseConnectState(
        window.djiBridge?.platformIsComponentLoaded?.("thing"),
      );
      if (thingLoaded) {
        const reconnectResult = bridgeCall("Thing reconnect", (bridge) => {
          if (!bridge.thingConnect) {
            throw new Error("Metodo JSBridge indisponivel: thingConnect");
          }
          return bridge.thingConnect(
            config.mqtt_username ?? "",
            config.mqtt_password ?? "",
            "connectCallback",
          );
        });
        if (reconnectResult.code !== 0) {
          throw new Error(reconnectResult.message ?? "Falha ao reconectar MQTT");
        }
      } else {
        const thingResult = bridgeCall("Thing module", (bridge) => {
          if (!bridge.platformLoadComponent) {
            throw new Error("Metodo JSBridge indisponivel: platformLoadComponent");
          }
          return bridge.platformLoadComponent(
            "thing",
            JSON.stringify({
              host: config.mqtt_url,
              connectCallback: "connectCallback",
              username: config.mqtt_username,
              password: config.mqtt_password,
            }),
          );
        });
        if (thingResult.code !== 0) throw new Error(thingResult.message ?? "Falha no modulo MQTT");
      }
      let connectState: boolean | undefined;
      let mqttConfirmed = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const rawConnectState = window.djiBridge?.thingGetConnectState?.();
        connectState = parseConnectState(rawConnectState);
        if (connectState !== undefined) break;
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      if (connectState === true) {
        mqttConfirmed = true;
        setMqttState("connected");
        setStep("thing", "ok", "MQTT ligado (thingGetConnectState=true).");
      } else {
        setMqttState("unknown");
        setStep(
          "thing",
          "running",
          connectState === false
            ? "Pilot reportou estado local desligado; a validar sessão MQTT real no backend."
            : "A validar estado MQTT no backend.",
        );
        const backendDeadline = Date.now() + 10000;
        while (Date.now() < backendDeadline) {
          const backendStatus = await getBackendMqttStatus();
          const receivedDeviceMessages = Object.values(backendStatus?.devices ?? {}).some(
            (device) => device.message_count > 0,
          );
          if (backendStatus?.connected && receivedDeviceMessages) {
            mqttConfirmed = true;
            backendMqttConfirmed.current = true;
            setMqttState("connected");
            setStep("thing", "ok", "MQTT confirmado pelo backend e por mensagens DJI recebidas.");
            break;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
        }
      }

      if (!mqttConfirmed) {
        setStep("tsa", "skipped", "Bloqueado: MQTT ainda não está ligado.");
        setError("O módulo MQTT não confirmou ligação. WS/TSA não serão iniciados.");
        return;
      }

      setStep("liveshare", "running", "A carregar modulo DJI liveshare.");
      const liveshareLoaded = parseConnectState(
        window.djiBridge?.platformIsComponentLoaded?.("liveshare"),
      );
      if (!liveshareLoaded) {
        const liveshareResult = bridgeCall("Liveshare module", (bridge) => {
          if (!bridge.platformLoadComponent) {
            throw new Error("Metodo JSBridge indisponivel: platformLoadComponent");
          }
          return bridge.platformLoadComponent(
            "liveshare",
            JSON.stringify({
              videoPublishType: "video-on-demand",
              statusCallback: "liveStatusCallback",
            }),
          );
        });
        if (liveshareResult.code !== 0) {
          throw new Error(liveshareResult.message ?? "Falha no modulo liveshare");
        }
      }
      setStep("liveshare", "ok", "Liveshare carregado; a aguardar live_capacity/live_status.");

      const gatewaySn =
        parseBridgeData<string>(window.djiBridge?.platformGetRemoteControllerSN?.()) ?? "--";
      setControllerSn(gatewaySn);
      if (gatewaySn !== "--" && config.workspace_id) {
        const bindingResponse = await fetch(
          `${apiBaseUrl}/manage/api/v1/devices/${encodeURIComponent(gatewaySn)}/binding`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-auth-token": config.api_token ?? "",
            },
            body: JSON.stringify({
              device_sn: gatewaySn,
              user_id: config.workspace_id,
              workspace_id: config.workspace_id,
            }),
          },
        );
        const bindingResult = (await bindingResponse.json()) as { code?: number; message?: string };
        if (!bindingResponse.ok || bindingResult.code !== 0) {
          throw new Error(bindingResult.message ?? "Falha no binding do gateway DJI");
        }
        setStep("thing", "ok", `MQTT ligado e gateway ${gatewaySn} associado ao workspace.`);
      }

      if (!config.ws_host) {
        setStep("tsa", "skipped", "Pendente: falta configurar ws_host.");
      } else {
        setStep("tsa", "running", "A carregar modulo WebSocket.");
        const wsResult = bridgeCall("WS module", (bridge) => {
          if (!bridge.platformLoadComponent) {
            throw new Error("Metodo JSBridge indisponivel: platformLoadComponent");
          }
          return bridge.platformLoadComponent(
            "ws",
            JSON.stringify({
              host: config.ws_host,
              token: config.api_token,
              connectCallback: "uasPilotBridgeWsCallback",
            }),
          );
        });
        if (wsResult.code !== 0) throw new Error(wsResult.message ?? "Falha no modulo WS");

        setStep("tsa", "running", "A carregar modulo TSA.");
        const tsaResult = bridgeCall("TSA module", (bridge) => {
          if (!bridge.platformLoadComponent) {
            throw new Error("Metodo JSBridge indisponivel: platformLoadComponent");
          }
          return bridge.platformLoadComponent("tsa", JSON.stringify({}));
        });
        if (tsaResult.code !== 0) throw new Error(tsaResult.message ?? "Falha no modulo TSA");
        setStep("tsa", "ok", "WebSocket/TSA carregado; a aguardar dados reais do drone.");
      }
      setAircraftSn(parseBridgeData<string>(window.djiBridge?.platformGetAircraftSN?.()) ?? "--");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido na configuracao Pilot.");
    } finally {
      setIsConfiguring(false);
    }
  }

  return (
    <main className="pilot-page">
      <motion.section
        className="pilot-card"
        aria-labelledby="pilot-title"
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
      >
        <div className="pilot-card-header"><p className="eyebrow">DJI Pilot 2 Open Platform</p><ThemeToggle compact /></div>
        <h1 id="pilot-title">UAS Platform</h1>
        <p className="intro">
          Portal tecnico para autenticar o JSBridge, definir workspace e iniciar a ligacao Cloud API.
        </p>

        <div className="pilot-status-grid" aria-live="polite">
          <StatusTile label="JSBridge" value={window.djiBridge ? "Disponivel" : "Fora do Pilot"} />
          <StatusTile
            label="MQTT"
            value={
              mqttState === "connected"
                ? "Ligado"
                : mqttState === "disconnected"
                  ? "Desligado"
                  : "A verificar"
            }
          />
          <StatusTile label="Comando" value={controllerSn} />
          <StatusTile label="Drone" value={aircraftSn} />
        </div>

        <div className="config-list" aria-live="polite">
          {error ? <p className="error-text">API indisponivel: {error}</p> : null}
          {config ? (
            <>
              <ConfigRow label="Workspace" value={config.workspace_id ?? "Por configurar"} />
              <ConfigRow label="API" value={config.api_host} />
              <ConfigRow label="MQTT" value={config.mqtt_url} />
              <ConfigRow label="WebSocket" value={config.ws_host ?? "Pendente"} />
            </>
          ) : (
            <p>A carregar configuracao...</p>
          )}
        </div>

        <div className="step-list">
          {steps.map((step) => (
            <SetupStepRow key={step.id} step={step} />
          ))}
        </div>

        <button
          className="primary-action"
          type="button"
          disabled={!config || isConfiguring}
          onClick={runPilotSetup}
        >
          {isConfiguring ? "A configurar..." : "Configurar DJI Pilot 2"}
        </button>
      </motion.section>
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

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SetupStepRow({ step }: { step: SetupStep }) {
  const Icon =
    step.status === "ok"
      ? CheckCircle2
      : step.status === "error"
        ? XCircle
        : step.status === "skipped"
          ? ShieldAlert
          : CircleDashed;

  return (
    <div className={`setup-step ${step.status}`}>
      <Icon aria-hidden="true" size={20} />
      <div>
        <strong>{step.label}</strong>
        <span>{step.detail}</span>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

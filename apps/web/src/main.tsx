import React from "react";
import ReactDOM from "react-dom/client";
import {
  Activity,
  Battery,
  CheckCircle2,
  CircleDashed,
  MapPin,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Wifi,
  XCircle,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import maplibregl from "maplibre-gl";

import "./styles.css";
import "maplibre-gl/dist/maplibre-gl.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

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

type Telemetry = {
  drone_serial: string;
  gateway_serial: string;
  model: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude_m: number | null;
  speed_mps: number | null;
  heading_deg: number | null;
  battery_percent: number | null;
  gps_status: string | null;
  rtk_status: string | null;
  active_payload: string | null;
  flight_mode: string | null;
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
    id: "tsa",
    label: "TSA via WebSocket",
    status: "pending",
    detail: "Pendente ate implementarmos o modulo ws.",
  },
];

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
  if (mode === "pilot") return <PilotPage />;
  return window.location.pathname === "/history" ? <FlightHistoryPage /> : <OpsDashboard />;
}

function OpsDashboard() {
  const reduceMotion = useReducedMotion();
  const [telemetry, setTelemetry] = React.useState<Telemetry | null>(() => {
    try {
      const cached = window.localStorage.getItem("uas:last-telemetry");
      return cached ? (JSON.parse(cached) as Telemetry) : null;
    } catch {
      return null;
    }
  });
  const [history, setHistory] = React.useState<Telemetry[]>([]);
  const [track, setTrack] = React.useState<FlightTrack | null>(null);
  const [mqttStatus, setMqttStatus] = React.useState<MqttStatus | null>(null);
  const [statusLoading, setStatusLoading] = React.useState(true);
  const droneSn = "1581F5BKP256200BF008";

  React.useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [latestResponse, historyResponse, trackResponse, mqttResponse] = await Promise.all([
          fetch(`${apiBaseUrl}/api/v1/dji/mqtt/telemetry/${droneSn}/latest`, { cache: "no-store" }),
          fetch(`${apiBaseUrl}/api/v1/dji/mqtt/telemetry/${droneSn}/history?limit=200`, {
            cache: "no-store",
          }),
          fetch(`${apiBaseUrl}/api/v1/dji/mqtt/telemetry/${droneSn}/track`, { cache: "no-store" }),
          fetch(`${apiBaseUrl}/api/v1/dji/mqtt/status`, { cache: "no-store" }),
        ]);
        if (!active) return;
        if (latestResponse.ok) {
          const latest = (await latestResponse.json()) as Telemetry;
          setTelemetry(latest);
          window.localStorage.setItem("uas:last-telemetry", JSON.stringify(latest));
        }
        setHistory(historyResponse.ok ? ((await historyResponse.json()) as Telemetry[]) : []);
        setTrack(trackResponse.ok ? ((await trackResponse.json()) as FlightTrack) : null);
        setMqttStatus(mqttResponse.ok ? ((await mqttResponse.json()) as MqttStatus) : null);
      } catch {
        if (active) setMqttStatus(null);
      } finally {
        if (active) setStatusLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const telemetryFresh = telemetry
    ? Date.now() - new Date(telemetry.observed_at).getTime() < 15000
    : false;
  const online = telemetryFresh && (mqttStatus?.connected ?? true);
  const gatewayLastMessage = mqttStatus?.devices["4LFCM3M006Q6DR"]?.last_message_at;
  const gatewayOnline = Boolean(
    mqttStatus?.connected &&
      gatewayLastMessage &&
      Date.now() - new Date(gatewayLastMessage).getTime() < 15000,
  );
  const gatewayLabel = statusLoading ? "A verificar" : gatewayOnline ? "Online" : "Offline";
  const metrics = [
    { label: "Drones simultaneos", value: telemetry ? "1 / 2" : "0 / 2", icon: Radio },
    { label: "Gateway DJI", value: gatewayLabel, icon: Wifi },
    {
      label: "Bateria M30T",
      value: telemetry?.battery_percent == null ? "--" : `${Math.round(telemetry.battery_percent)}%`,
      icon: Battery,
    },
    {
      label: "Altitude",
      value: telemetry?.altitude_m == null ? "--" : `${telemetry.altitude_m.toFixed(1)} m`,
      icon: Activity,
    },
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
          <span className={`status-pill ${statusLoading ? "checking" : online ? "online" : "offline"}`}>
            {statusLoading ? "A verificar telemetria" : online ? "Telemetria online" : "Sem telemetria"}
          </span>
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
            <TelemetryMap history={history} track={track} />
            <div className="map-footer">
              <strong>Mapa em tempo real</strong>
              <span>
                {telemetry?.latitude && telemetry.longitude
                  ? `M30T ${telemetry.latitude.toFixed(5)}, ${telemetry.longitude.toFixed(5)}`
                  : "Sem posição GPS válida; o drone está a enviar 0,0 neste teste."}
              </span>
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
                <dd>{online ? "Online / telemetria recebida" : "A aguardar telemetria"}</dd>
              </div>
              <div>
                <dt>DJI Matrice 4T</dt>
                <dd>A aguardar registo via Pilot 2</dd>
              </div>
              <div>
                <dt>MQTT</dt>
                <dd>{mqttStatus?.connected ? "Ligado ao EMQX" : "A aguardar ligação"}</dd>
              </div>
              <div>
                <dt>Heading / velocidade</dt>
                <dd>
                  {telemetry?.heading_deg == null ? "--" : `${telemetry.heading_deg.toFixed(1)}°`}
                  {telemetry?.speed_mps == null ? " / --" : ` / ${telemetry.speed_mps.toFixed(1)} m/s`}
                </dd>
              </div>
              <div>
                <dt>Payload térmico</dt>
                <dd>{telemetry?.active_payload ?? "--"}</dd>
              </div>
            </dl>
          </article>
        </section>
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
  const droneSn = "1581F5BKP256200BF008";

  React.useEffect(() => {
    fetch(`${apiBaseUrl}/api/v1/dji/mqtt/telemetry/${droneSn}/tracks?limit=20`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => {
        const history = data as HistoricalTrack[];
        setTracks(history);
        setSelectedTrack(history[0] ?? null);
      })
      .catch(() => setTracks([]));
  }, []);

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
          <a className="nav-link" href="/pilot">Pilot 2</a>
        </nav>
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
      </section>
    </main>
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
  const routeFallbackPoints = React.useMemo(() => {
    if (routeCoordinates.length < 2) return "";
    const longitudes = routeCoordinates.map(([longitude]) => longitude);
    const latitudes = routeCoordinates.map(([, latitude]) => latitude);
    const minLongitude = Math.min(...longitudes);
    const maxLongitude = Math.max(...longitudes);
    const minLatitude = Math.min(...latitudes);
    const maxLatitude = Math.max(...latitudes);
    const longitudeRange = Math.max(maxLongitude - minLongitude, 0.00001);
    const latitudeRange = Math.max(maxLatitude - minLatitude, 0.00001);
    return routeCoordinates
      .map(([longitude, latitude]) => {
        const x = 6 + ((longitude - minLongitude) / longitudeRange) * 88;
        const y = 94 - ((latitude - minLatitude) / latitudeRange) * 88;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [routeCoordinates]);

  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
              "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
              "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
              "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
            ],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors © CARTO",
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
      {routeFallbackPoints ? (
        <svg className="route-fallback" viewBox="0 0 100 100" aria-label="Trajeto GPS">
          <polyline points={routeFallbackPoints} />
        </svg>
      ) : null}
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
        <p className="eyebrow">DJI Pilot 2 Open Platform</p>
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

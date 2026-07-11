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

import "./styles.css";

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
  devices: Record<string, { message_count: number }>;
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
      setControllerSn(parseBridgeData<string>(window.djiBridge?.platformGetRemoteControllerSN?.()) ?? "--");
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

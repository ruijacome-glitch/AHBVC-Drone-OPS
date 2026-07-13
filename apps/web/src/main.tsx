import React from "react";
import ReactDOM from "react-dom/client";
import {
  Activity,
  Ban,
  Boxes,
  ArrowRight,
  Check,
  CheckCircle2,
  Clipboard,
  CircleDashed,
  Clock3,
  Database,
  Eye,
  EyeOff,
  History,
  LockKeyhole,
  LogOut,
  Mail,
  MapPin,
  Moon,
  Pause,
  PlaneTakeoff,
  Play,
  Plus,
  Share2,
  Save,
  Pencil,
  Radio,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Square,
  Sun,
  Thermometer,
  UserRound,
  Users,
  Video,
  Wifi,
  ZoomIn,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import QRCode from "qrcode";
import maplibregl from "maplibre-gl";

import "./styles.css";
import "maplibre-gl/dist/maplibre-gl.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const productName = "AirSector";
const organisationName = "Bombeiros Voluntários de Cascais";

type Theme = "light" | "dark";

type AuthUser = {
  id: string;
  email: string;
  full_name: string;
  roles: string[];
};

type AuthContextValue = {
  user: AuthUser;
  logout: () => Promise<void>;
};

function preferredTheme(): Theme {
  const saved = window.localStorage.getItem("uas:theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const initialTheme = preferredTheme();
document.documentElement.dataset.theme = initialTheme;

const AuthContext = React.createContext<AuthContextValue | null>(null);
let refreshPromise: Promise<AuthUser | null> | null = null;

function readCookie(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  const cookie = document.cookie.split("; ").find((item) => item.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}

function csrfHeaders(): Record<string, string> {
  const token = readCookie("uas_csrf");
  return token ? { "x-csrf-token": token } : {};
}

async function refreshAuthSession(): Promise<AuthUser | null> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${apiBaseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: csrfHeaders(),
    })
      .then(async (response) => response.ok ? ((await response.json()) as AuthUser) : null)
      .catch(() => null)
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const request = () => {
    const headers = new Headers(init.headers);
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      Object.entries(csrfHeaders()).forEach(([key, value]) => headers.set(key, value));
    }
    return fetch(`${apiBaseUrl}${path}`, { ...init, headers, credentials: "include" });
  };
  let response = await request();
  if (response.status === 401) {
    const refreshed = await refreshAuthSession();
    if (refreshed) response = await request();
    else window.dispatchEvent(new Event("uas:session-expired"));
  }
  return response;
}

function useAuth(): AuthContextValue {
  const value = React.useContext(AuthContext);
  if (!value) throw new Error("Authentication context unavailable");
  return value;
}

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

type Equipment = {
  equipment_type: "controller" | "drone" | "payload";
  id: string;
  serial_number: string;
  callsign: string | null;
  display_name: string | null;
  model: string | null;
  online_status: string | null;
  last_seen_at: string | null;
  drone_id: string | null;
  payload_type: string | null;
  status: string | null;
  notes: string | null;
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
    const response = await authenticatedFetch("/api/v1/dji/pilot/mqtt-status", { cache: "no-store" });
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

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    async function restoreSession() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/auth/me`, { credentials: "include" });
        const restored = response.ok ? ((await response.json()) as AuthUser) : await refreshAuthSession();
        if (active) setUser(restored);
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    }
    const expire = () => setUser(null);
    window.addEventListener("uas:session-expired", expire);
    void restoreSession();
    return () => {
      active = false;
      window.removeEventListener("uas:session-expired", expire);
    };
  }, []);

  async function logout() {
    try {
      await fetch(`${apiBaseUrl}/api/v1/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders(),
      });
    } finally {
      setUser(null);
    }
  }

  if (loading) return <AuthLoadingPage />;
  if (!user) return <LoginPage onAuthenticated={setUser} />;
  return <AuthContext.Provider value={{ user, logout }}>{children}</AuthContext.Provider>;
}

function AuthLoadingPage() {
  return <main className="auth-page"><div className="auth-loading" role="status"><img src="/ahbvc.png" alt="Bombeiros Voluntários de Cascais" /><CircleDashed className="spin" size={24} /><span>A validar sessão segura...</span></div></main>;
}

function LoginPage({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const reduceMotion = useReducedMotion();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(response.status === 429 ? "Demasiadas tentativas. Aguarde alguns minutos." : result.detail ?? "Não foi possível iniciar sessão.");
      }
      onAuthenticated((await response.json()) as AuthUser);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível iniciar sessão.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-theme"><ThemeToggle compact /></div>
      <motion.section className="auth-panel" initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24 }} aria-labelledby="login-title">
        <header className="auth-brand"><img src="/ahbvc.png" alt={`Logótipo dos ${organisationName}`} /><div><span>{organisationName}</span><strong>{productName}</strong></div></header>
        <div className="auth-copy"><p className="eyebrow">Acesso reservado</p><h1 id="login-title">Iniciar sessão</h1><p>Entre com a sua conta operacional para aceder à plataforma.</p></div>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="login-email">Email institucional</label>
          <div className="auth-input"><Mail size={18} aria-hidden="true" /><input id="login-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
          <label htmlFor="login-password">Password</label>
          <div className="auth-input"><LockKeyhole size={18} aria-hidden="true" /><input id="login-password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Ocultar password" : "Mostrar password"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <button className="primary-action auth-submit" type="submit" disabled={submitting}>{submitting ? <CircleDashed className="spin" size={18} /> : <LockKeyhole size={18} />}{submitting ? "A autenticar..." : "Entrar"}</button>
        </form>
        <footer className="auth-footer"><ShieldCheck size={16} aria-hidden="true" /><span>Ligação segura e acesso sujeito a auditoria.</span></footer>
      </motion.section>
    </main>
  );
}

type NavigationPage = "operations" | "missions" | "history" | "stream" | "equipment" | "users";

function AppSidebar({ active }: { active: NavigationPage }) {
  const { user, logout } = useAuth();
  const isAdmin = user.roles.includes("Administrador");
  return (
    <aside className="sidebar" aria-label="Navegação principal">
      <div className="brand-lockup"><img className="brand-logo" src="/ahbvc.png" alt="AHBVC" /><div><strong>{productName}</strong><span>AHBVC · Critical Operations</span></div></div>
      <nav>
        <a className={`nav-link ${active === "operations" ? "active" : ""}`} href="/">Operações</a>
        <a className={`nav-link ${active === "missions" ? "active" : ""}`} href="/missions">Missões</a>
        <a className={`nav-link ${active === "history" ? "active" : ""}`} href="/history">Histórico de voo</a>
        <a className={`nav-link ${active === "stream" ? "active" : ""}`} href="/stream">Livestream</a>
        <a className={`nav-link ${active === "equipment" ? "active" : ""}`} href="/equipment">Equipamentos</a>
        {isAdmin ? <a className={`nav-link ${active === "users" ? "active" : ""}`} href="/users">Utilizadores</a> : null}
        <a className="nav-link" href="https://pilot.uas.ahbvc.org.pt">Pilot 2</a>
      </nav>
      <div className="sidebar-footer">
        <ThemeToggle />
        <div className="session-user"><UserRound size={18} aria-hidden="true" /><span><strong>{user.full_name}</strong><small>{user.roles.join(" · ")}</small></span><button type="button" onClick={() => void logout()} aria-label="Terminar sessão" title="Terminar sessão"><LogOut size={18} /></button></div>
      </div>
    </aside>
  );
}

function ProtectedApp({ mode }: { mode: "pilot" | "ops" }) {
  const { user } = useAuth();
  if (mode === "pilot") {
    return user.roles.some((role) => role === "Piloto" || role === "Administrador")
      ? <PilotPage />
      : <PilotAccessDeniedPage />;
  }
  const path = window.location.pathname;
  if (path === "/stream") return <LiveStreamPage />;
  if (path === "/equipment") return <EquipmentPage />;
  if (path === "/users") return user.roles.includes("Administrador") ? <UserManagementPage /> : <AccessDeniedPage />;
  if (path.startsWith("/missions/")) return <MissionDetailPage missionId={path.split("/")[2] ?? ""} />;
  if (path === "/missions") return <MissionManagementPage />;
  if (path === "/history") return <FlightHistoryPage />;
  return <OpsDashboard />;
}

function AccessDeniedPage() {
  return <main className="app-shell"><AppSidebar active="operations" /><section className="workspace access-denied"><ShieldAlert size={36} /><h1>Acesso não autorizado</h1><p>O seu perfil não tem permissão para abrir esta área.</p><a className="primary-action" href="/">Voltar às operações</a></section></main>;
}

function EquipmentPage() {
  const { user } = useAuth();
  const canEdit = user.roles.some((role) => role === "Administrador" || role === "Operador");
  const [equipment, setEquipment] = React.useState<Equipment[]>([]);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState({ callsign: "", display_name: "", notes: "", status: "" });
  const [message, setMessage] = React.useState<string | null>(null);

  const loadEquipment = React.useCallback(async () => {
    const response = await authenticatedFetch("/api/v1/equipment", { cache: "no-store" });
    if (response.ok) setEquipment(((await response.json()) as { equipment: Equipment[] }).equipment);
  }, []);

  React.useEffect(() => { void loadEquipment(); }, [loadEquipment]);

  function beginEdit(item: Equipment) {
    setEditing(item.id);
    setDraft({ callsign: item.callsign ?? "", display_name: item.display_name ?? "", notes: item.notes ?? "", status: item.status ?? "available" });
    setMessage(null);
  }

  async function save(item: Equipment) {
    const response = await authenticatedFetch(`/api/v1/equipment/${item.equipment_type}/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as { detail?: string };
      setMessage(result.detail ?? "Não foi possível guardar o equipamento.");
      return;
    }
    setEditing(null);
    setMessage("Identificação operacional atualizada.");
    await loadEquipment();
  }

  const typeLabel = { controller: "Comando", drone: "Aeronave", payload: "Payload" };
  const grouped = ["controller", "drone", "payload"].map((type) => ({
    type: type as Equipment["equipment_type"],
    items: equipment.filter((item) => item.equipment_type === type),
  }));

  return <main className="app-shell"><AppSidebar active="equipment" /><section className="workspace">
    <header className="topbar"><div><p className="eyebrow">Inventário operacional</p><h1>Equipamentos</h1><span className="mission-subtitle">Identidade técnica, indicativos e estado dos meios DJI.</span></div><span className="status-pill online">{equipment.length} registados</span></header>
    <div className="operations-notice"><Boxes size={20} /><div><strong>SN técnico e indicativo operacional</strong><span>O número de série é mantido como identidade DJI. O indicativo pode ser alterado pela organização e aparece nas missões, mapas e relatórios.</span></div></div>
    {message ? <p className="operations-message" role="status">{message}</p> : null}
    <section className="equipment-grid">{grouped.map((group) => <section className="panel equipment-panel" key={group.type}><div className="panel-heading"><Boxes size={20} /><div><h2>{typeLabel[group.type]}</h2><span>{group.items.length} equipamento{group.items.length === 1 ? "" : "s"}</span></div></div>{group.items.length ? <div className="equipment-list">{group.items.map((item) => { const isEditing = editing === item.id; return <div className="equipment-row" key={`${item.equipment_type}-${item.id}`}><div className="equipment-icon"><Boxes size={18} /></div><div className="equipment-identity">{isEditing ? <><input aria-label="Indicativo" value={draft.callsign} onChange={(event) => setDraft({ ...draft, callsign: event.target.value })} placeholder="Indicativo" /><input aria-label="Nome operacional" value={draft.display_name} onChange={(event) => setDraft({ ...draft, display_name: event.target.value })} placeholder="Nome operacional" /></> : <><strong>{item.callsign || item.display_name || "Sem indicativo"}</strong><span>{item.display_name || "Sem nome operacional"}</span></>}<code>{item.serial_number}</code></div><div className="equipment-meta"><span>{item.model || item.payload_type || "Modelo não identificado"}</span>{item.equipment_type === "payload" ? <span>{isEditing ? <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="available">Disponível</option><option value="in_use">Em uso</option><option value="maintenance">Manutenção</option><option value="retired">Retirado</option></select> : item.status}</span> : <span className={`service-state ${item.online_status === "online" ? "is-online" : "is-offline"}`}><span />{item.online_status === "online" ? "Online" : "Offline"}</span>}</div>{canEdit ? <button className="icon-action" type="button" onClick={() => isEditing ? void save(item) : beginEdit(item)} aria-label={isEditing ? "Guardar equipamento" : "Editar equipamento"} title={isEditing ? "Guardar" : "Editar"}>{isEditing ? <Save size={17} /> : <Pencil size={17} />}</button> : null}</div>; })}</div> : <p className="empty-state">Ainda não existem equipamentos deste tipo.</p>}</section>)}</section>
  </section></main>;
}

function App() {
  const mode = useHostMode();
  if (mode === "ops" && window.location.pathname === "/share") return <PublicSharePage />;
  if (mode === "ops" && window.location.pathname === "/activate") {
    return <ActivateAccountPage />;
  }
  return <AuthProvider><ProtectedApp mode={mode} /></AuthProvider>;
}

type PublicShare = {
  label: string;
  gateway_sn: string;
  video_id: string | null;
  permissions: string[];
  expires_at: string;
  stream_url: string;
};

type ManagedShare = {
  id: string;
  label: string;
  gateway_sn: string;
  video_id: string | null;
  permissions: string[];
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  last_accessed_at: string | null;
};

function PublicSharePage() {
  const [share, setShare] = React.useState<PublicShare | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  React.useEffect(() => {
    if (!token) { setError("Link de partilha inválido."); return; }
    fetch(`${apiBaseUrl}/api/v1/stream-shares/public/${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Este link expirou ou foi revogado.");
        setShare((await response.json()) as PublicShare);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Link indisponível."));
  }, [token]);

  return <main className="public-share-page"><motion.section className="public-share-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}><header className="auth-brand"><img src="/ahbvc.png" alt="AHBVC" /><div><span>Partilha operacional</span><strong>AirSector</strong></div></header>{error ? <div className="public-share-error"><ShieldAlert size={28} /><h1>Link indisponível</h1><p>{error}</p></div> : share ? <><div className="public-share-heading"><p className="eyebrow">Acesso partilhado</p><h1>{share.label}</h1><span>Expira em {new Date(share.expires_at).toLocaleString("pt-PT")}</span></div>{share.permissions.includes("video") ? <iframe className="public-share-player" title={`Stream ${share.label}`} src={`${share.stream_url}/`} allow="autoplay; fullscreen" /> : <div className="public-share-empty"><Video size={32} /><span>Este link não inclui vídeo.</span></div>}<div className="public-share-permissions">{share.permissions.map((permission) => <span key={permission}><CheckCircle2 size={15} />{permission}</span>)}</div></> : <div className="public-share-loading"><CircleDashed className="spin" size={26} /><span>A validar link seguro...</span></div>}</motion.section></main>;
}

function ActivateAccountPage() {
  const reduceMotion = useReducedMotion();
  const [token] = React.useState(() => new URLSearchParams(window.location.search).get("token") ?? "");
  const [password, setPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [complete, setComplete] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", "/activate");
  }, []);

  async function activate(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmation) { setError("As passwords não coincidem."); return; }
    setSubmitting(true); setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/auth/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, password_confirmation: confirmation }),
      });
      const result = (await response.json().catch(() => ({}))) as { detail?: string | Array<{ msg: string }> };
      if (!response.ok) {
        const detail = Array.isArray(result.detail) ? result.detail[0]?.msg : result.detail;
        throw new Error(response.status === 400 ? "O convite é inválido ou expirou." : detail ?? "Não foi possível ativar a conta.");
      }
      setComplete(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível ativar a conta.");
    } finally { setSubmitting(false); }
  }

  return (
    <main className="auth-page">
      <div className="auth-theme"><ThemeToggle compact /></div>
      <motion.section className="auth-panel" initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24 }} aria-labelledby="activation-title">
        <header className="auth-brand"><img src="/ahbvc.png" alt={`Logótipo dos ${organisationName}`} /><div><span>{organisationName}</span><strong>{productName}</strong></div></header>
        {complete ? <div className="auth-complete"><CheckCircle2 size={38} /><h1 id="activation-title">Conta ativada</h1><p>A password foi definida. Já pode iniciar sessão na plataforma.</p><a className="primary-action" href="/">Iniciar sessão</a></div> : <>
          <div className="auth-copy"><p className="eyebrow">Ativação de conta</p><h1 id="activation-title">Definir password</h1><p>Escolha uma password segura para concluir o seu registo.</p></div>
          <form className="auth-form" onSubmit={activate}>
            <label htmlFor="activation-password">Nova password</label>
            <div className="auth-input"><LockKeyhole size={18} /><input id="activation-password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar password" : "Mostrar password"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
            <label htmlFor="activation-confirmation">Confirmar password</label>
            <div className="auth-input"><LockKeyhole size={18} /><input id="activation-confirmation" type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={12} required /></div>
            <p className="password-guidance">Mínimo 12 caracteres, incluindo maiúscula, minúscula e número.</p>
            {!token ? <p className="auth-error" role="alert">O link de convite está incompleto.</p> : null}
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <button className="primary-action auth-submit" type="submit" disabled={!token || submitting}>{submitting ? <CircleDashed className="spin" size={18} /> : <ShieldCheck size={18} />}{submitting ? "A ativar..." : "Ativar conta"}</button>
          </form>
        </>}
      </motion.section>
    </main>
  );
}

function PilotAccessDeniedPage() {
  const { logout } = useAuth();
  return <main className="pilot-page"><section className="pilot-card pilot-access-denied"><ShieldAlert size={34} /><h1>Acesso de piloto necessário</h1><p>Esta conta não tem o perfil Piloto atribuído.</p><button className="primary-action" type="button" onClick={() => void logout()}><LogOut size={18} />Terminar sessão</button></section></main>;
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
        const response = await authenticatedFetch("/api/v1/dashboard/summary", { cache: "no-store" });
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
    { label: "Gerir missões", detail: "Ocorrências e vários voos", href: "/missions", icon: PlaneTakeoff },
    { label: "Abrir livestream", detail: "Iniciar ou acompanhar vídeo", href: "/stream", icon: Video },
    { label: "Consultar voos", detail: "Rotas e telemetria histórica", href: "/history", icon: History },
    { label: "Configurar Pilot 2", detail: "Portal DJI Cloud Services", href: "https://pilot.uas.ahbvc.org.pt", icon: Radio },
  ];

  return (
    <main className="app-shell">
      <AppSidebar active="operations" />

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
  drone_serial: string;
  drone_callsign: string | null;
  pilot_name: string | null;
};

function FlightHistoryPage() {
  const [tracks, setTracks] = React.useState<HistoricalTrack[]>([]);
  const [selectedTrack, setSelectedTrack] = React.useState<HistoricalTrack | null>(null);
  const [telemetry, setTelemetry] = React.useState<Telemetry[]>([]);
  const [playbackIndex, setPlaybackIndex] = React.useState(0);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const droneSn = "1581F5BKP256200BF008";

  React.useEffect(() => {
    Promise.all([
      authenticatedFetch(`/api/v1/dji/mqtt/telemetry/${droneSn}/tracks?limit=20`, { cache: "no-store" }),
      authenticatedFetch(`/api/v1/dji/mqtt/telemetry/${droneSn}/history?limit=500`, { cache: "no-store" }),
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
  const orderedSelectedTelemetry = selectedTelemetry.slice().sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  const playbackPoint = orderedSelectedTelemetry[playbackIndex] ?? null;
  const playbackPosition: [number, number] | null = playbackPoint?.latitude != null && playbackPoint.longitude != null
    ? [playbackPoint.longitude, playbackPoint.latitude]
    : null;

  React.useEffect(() => {
    setPlaybackIndex(0);
    setIsPlaying(false);
  }, [selectedTrack?.id]);

  React.useEffect(() => {
    if (!isPlaying || orderedSelectedTelemetry.length < 2) return;
    const timer = window.setInterval(() => {
      setPlaybackIndex((current) => {
        if (current >= orderedSelectedTelemetry.length - 1) {
          setIsPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [isPlaying, orderedSelectedTelemetry.length]);

  function resetPlayback() {
    setIsPlaying(false);
    setPlaybackIndex(0);
  }

  return (
    <main className="app-shell">
      <AppSidebar active="history" />
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
                <span>{trackItem.drone_callsign || trackItem.drone_serial}</span>
                <span>Piloto: {trackItem.pilot_name || "Não registado"}</span>
                <span>{trackItem.point_count} pontos GPS · {trackItem.ended_at ? "Concluído" : "Em curso"}</span>
              </button>
            ))}
          </div>
          <div className="history-map">
            {selectedTrack ? <TelemetryMap history={[]} track={selectedTrack} playbackPosition={playbackPosition} /> : <div className="map-empty"><MapPin size={28} /><strong>Selecione um voo</strong></div>}
          </div>
        </section>
        {selectedTrack ? <><div className="history-equipment-strip"><span><strong>Drone</strong>{selectedTrack.drone_callsign || "Sem indicativo"}<small>{selectedTrack.drone_serial}</small></span><span><strong>Piloto</strong>{selectedTrack.pilot_name || "Não registado"}</span></div><section className="playback-panel panel" aria-label="Reprodução do voo"><div><p className="eyebrow">Reprodução do voo</p><strong>{playbackPoint ? new Date(playbackPoint.observed_at).toLocaleString("pt-PT") : "Sem telemetria GPS"}</strong><span>{orderedSelectedTelemetry.length ? `${playbackIndex + 1} / ${orderedSelectedTelemetry.length} pontos` : "Sem pontos disponíveis"}</span></div><div className="playback-facts"><span>Altitude <strong>{playbackPoint?.altitude_m != null ? `${playbackPoint.altitude_m.toFixed(1)} m` : "--"}</strong></span><span>Velocidade <strong>{playbackPoint?.speed_mps != null ? `${playbackPoint.speed_mps.toFixed(1)} m/s` : "--"}</strong></span><span>Bateria <strong>{playbackPoint?.battery_percent != null ? `${playbackPoint.battery_percent}%` : "--"}</strong></span></div><div className="playback-actions"><button className="primary-action" type="button" disabled={orderedSelectedTelemetry.length < 2} onClick={() => { if (playbackIndex >= orderedSelectedTelemetry.length - 1) setPlaybackIndex(0); setIsPlaying((value) => !value); }}>{isPlaying ? <Pause size={17} /> : <Play size={17} />}{isPlaying ? "Pausar" : "Reproduzir"}</button><button className="secondary-action" type="button" onClick={resetPlayback}><RotateCcw size={17} />Recomeçar</button></div><input className="playback-slider" type="range" min="0" max={Math.max(orderedSelectedTelemetry.length - 1, 0)} value={Math.min(playbackIndex, Math.max(orderedSelectedTelemetry.length - 1, 0))} onChange={(event) => { setIsPlaying(false); setPlaybackIndex(Number(event.target.value)); }} aria-label="Posição na reprodução do voo" /></section><TelemetryCharts points={selectedTelemetry} /></> : null}
      </section>
    </main>
  );
}

function LiveStreamPage() {
  const { user } = useAuth();
  const canControl = user.roles.some((role) => ["Administrador", "Operador", "Piloto"].includes(role));
  const [options, setOptions] = React.useState<LivestreamOption[]>([]);
  const [selectedVideoId, setSelectedVideoId] = React.useState("");
  const [quality, setQuality] = React.useState("0");
  const [streaming, setStreaming] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [sending, setSending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [shareLabel, setShareLabel] = React.useState("Partilha de operação");
  const [shareExpiry, setShareExpiry] = React.useState("8");
  const [sharePermissions, setSharePermissions] = React.useState<string[]>(["video"]);
  const [shareUrl, setShareUrl] = React.useState<string | null>(null);
  const [shareSaving, setShareSaving] = React.useState(false);
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
  const [shares, setShares] = React.useState<ManagedShare[]>([]);
  const [sharesLoading, setSharesLoading] = React.useState(false);
  const [revokingShareId, setRevokingShareId] = React.useState<string | null>(null);
  const selectedOption = options.find((option) => option.video_id === selectedVideoId) ?? options[0];
  const gatewaySn = selectedOption?.gateway_sn ?? "";
  const streamUrl = `https://stream.uas.ahbvc.org.pt/live/${gatewaySn}`;
  const hlsUrl = `${streamUrl}/index.m3u8`;

  const loadOptions = React.useCallback(async () => {
    try {
      const optionsResponse = await authenticatedFetch("/api/v1/livestreams/options", { cache: "no-store" });
      if (!optionsResponse.ok) throw new Error("Configuração indisponível");
      const result = (await optionsResponse.json()) as { options: LivestreamOption[] };
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

  const loadShares = React.useCallback(async () => {
    if (!canControl) return;
    setSharesLoading(true);
    try {
      const response = await authenticatedFetch("/api/v1/stream-shares", { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível carregar as partilhas.");
      setShares((await response.json()) as ManagedShare[]);
    } catch {
      setShares([]);
    } finally {
      setSharesLoading(false);
    }
  }, [canControl]);

  React.useEffect(() => { void loadShares(); }, [loadShares]);

  React.useEffect(() => {
    if (!shareUrl) { setQrDataUrl(null); return; }
    void QRCode.toDataURL(shareUrl, { width: 240, margin: 1, errorCorrectionLevel: "M" }).then(setQrDataUrl).catch(() => setQrDataUrl(null));
  }, [shareUrl]);

  async function sendCommand(action: "start" | "stop") {
    if (!selectedOption) {
      setMessage("A configuração DJI ainda não está pronta.");
      return;
    }
    setSending(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch(`/api/v1/livestreams/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  async function createShareLink(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedOption) return;
    setShareSaving(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/v1/stream-shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: shareLabel, gateway_sn: selectedOption.gateway_sn, video_id: selectedOption.video_id, permissions: sharePermissions, expires_in_hours: Number(shareExpiry) }),
      });
      const result = (await response.json().catch(() => ({}))) as { public_url?: string; detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Não foi possível criar o link.");
      setShareUrl(result.public_url ?? null);
      await loadShares();
      setMessage("Link de partilha criado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível criar o link.");
    } finally { setShareSaving(false); }
  }

  async function revokeShareLink(shareId: string) {
    setRevokingShareId(shareId);
    try {
      const response = await authenticatedFetch(`/api/v1/stream-shares/${shareId}/revoke`, { method: "POST" });
      if (!response.ok) throw new Error("Não foi possível revogar o link.");
      setMessage("Link revogado.");
      await loadShares();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível revogar o link.");
    } finally {
      setRevokingShareId(null);
    }
  }

  function toggleSharePermission(permission: string) {
    setSharePermissions((current) => current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]);
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
      <AppSidebar active="stream" />
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
            {canControl ? <><label>Qualidade<select value={quality} onChange={(event) => setQuality(event.target.value)}><option value="0">Adaptativa</option><option value="1">Fluida</option><option value="2">SD</option><option value="3">HD</option><option value="4">UHD</option></select></label>
            <div className="stream-actions"><button className="primary-action" type="submit" disabled={!selectedOption || sending}><Play size={18} />{sending ? "A enviar..." : "Iniciar stream"}</button><button className="secondary-action" type="button" disabled={!selectedOption || sending} onClick={() => void sendCommand("stop")}><Square size={16} />Parar</button></div></> : <p className="stream-readonly"><ShieldCheck size={17} />Modo de observação: controlo da transmissão indisponível para este perfil.</p>}
            {message ? <p className="stream-message" role="status">{message}</p> : null}
            {gatewaySn ? <details className="stream-technical"><summary>Detalhes técnicos</summary><span>Gateway: {gatewaySn}</span><span>Video ID: {selectedOption?.video_id}</span><span>WebRTC: <a href={streamUrl} target="_blank" rel="noreferrer">abrir player</a></span><span>HLS: <a href={hlsUrl} target="_blank" rel="noreferrer">abrir playlist</a></span></details> : null}
          </form>
          <div className="stream-view panel">{gatewaySn ? <iframe key={streamUrl} title="DJI WebRTC livestream" src={streamUrl} allow="autoplay; fullscreen" /> : <div className="stream-placeholder"><Radio size={40} /><strong>Sem fonte disponível</strong><span>A aguardar uma câmara anunciada pelo Pilot 2.</span></div>}</div>
        </section>
        {canControl ? <>
          <form className="panel share-panel" onSubmit={createShareLink}><div className="panel-heading"><Share2 size={20} /><div><h2>Partilhar stream</h2><span>Crie um link temporário sem expor credenciais DJI.</span></div></div><div className="share-form-grid"><label>Nome da partilha<input value={shareLabel} onChange={(event) => setShareLabel(event.target.value)} required /></label><label>Expira<select value={shareExpiry} onChange={(event) => setShareExpiry(event.target.value)}><option value="1">1 hora</option><option value="8">8 horas</option><option value="24">24 horas</option><option value="72">3 dias</option><option value="168">7 dias</option></select></label></div><fieldset className="share-permissions"><legend>Permissões do link</legend><label><input type="checkbox" checked disabled />Vídeo ao vivo</label>{["map", "telemetry", "markers", "history"].map((permission) => <label key={permission}><input type="checkbox" checked={sharePermissions.includes(permission)} onChange={() => toggleSharePermission(permission)} />{permission === "map" ? "Mapa" : permission === "telemetry" ? "Telemetria" : permission === "markers" ? "Marcadores" : "Histórico"}</label>)}</fieldset><button className="primary-action" type="submit" disabled={!selectedOption || shareSaving}><Share2 size={17} />{shareSaving ? "A criar..." : "Criar link"}</button>{shareUrl ? <div className="share-result"><div className="share-link-fields"><input readOnly value={shareUrl} aria-label="Link público criado" /><div className="share-link-actions"><button className="icon-action" type="button" title="Copiar link" aria-label="Copiar link" onClick={() => void navigator.clipboard.writeText(shareUrl)}><Clipboard size={17} /></button><a href={shareUrl} target="_blank" rel="noreferrer">Abrir</a></div></div>{qrDataUrl ? <div className="share-qr"><img src={qrDataUrl} alt="QR Code do link de partilha" /><span>Leia para abrir rapidamente</span></div> : null}</div> : null}</form>
          <section className="panel share-history-panel"><div className="panel-heading"><History size={20} /><div><h2>Links emitidos</h2><span>Revogue acessos que já não devem estar disponíveis.</span></div><button className="icon-action" type="button" onClick={() => void loadShares()} aria-label="Atualizar links" title="Atualizar links"><RefreshCw size={18} /></button></div>{sharesLoading ? <p className="share-history-empty">A carregar links...</p> : shares.length === 0 ? <p className="share-history-empty">Ainda não foram criados links de partilha.</p> : <div className="share-history-list">{shares.map((share) => { const expired = new Date(share.expires_at).getTime() <= Date.now(); const status = share.revoked_at ? "Revogado" : expired ? "Expirado" : "Activo"; return <div className="share-history-row" key={share.id}><div><strong>{share.label}</strong><span>{share.gateway_sn} · {share.permissions.join(", ")}</span><small>Expira {new Date(share.expires_at).toLocaleString("pt-PT")}{share.last_accessed_at ? ` · último acesso ${new Date(share.last_accessed_at).toLocaleString("pt-PT")}` : ""}</small></div><div className="share-history-actions"><span className={`share-status ${status === "Activo" ? "active" : "inactive"}`}>{status}</span>{!share.revoked_at && !expired ? <button className="icon-action danger-action" type="button" title="Revogar link" aria-label={`Revogar ${share.label}`} disabled={revokingShareId === share.id} onClick={() => void revokeShareLink(share.id)}><Ban size={17} /></button> : null}</div></div>; })}</div>}</section>
        </> : null}
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
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
  const valid = series.values.filter((value): value is number => value != null && Number.isFinite(value));
  if (valid.length === 0) {
    return <article className="chart-card"><strong>{series.label}</strong><span className="chart-empty">Sem dados</span></article>;
  }
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = Math.max(max - min, 1);
  const dataPoints = series.values.map((value, index) => {
    if (value == null) return null;
    const x = series.values.length === 1 ? 50 : (index / (series.values.length - 1)) * 100;
    const y = 92 - ((value - min) / range) * 78;
    return { index, value, x, y };
  }).filter((point): point is { index: number; value: number; x: number; y: number } => point !== null);
  const points = dataPoints.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const hoveredPoint = hoveredIndex == null ? null : dataPoints.find((point) => point.index === hoveredIndex) ?? null;
  const fillPoints = `${points} 100,92 0,92`;

  function handleChartMove(event: React.MouseEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    setHoveredIndex(Math.round(position * Math.max(series.values.length - 1, 0)));
  }

  return (
    <article className="chart-card">
      <div className="chart-heading"><strong>{series.label}</strong><span>{min.toFixed(1)} - {max.toFixed(1)}</span></div>
      <div className="telemetry-chart-wrap">
      <svg className="telemetry-chart" viewBox="0 0 100 100" role="img" aria-label={series.label} onMouseMove={handleChartMove} onMouseLeave={() => setHoveredIndex(null)}>
        <line x1="0" y1="92" x2="100" y2="92" className="chart-axis" />
        <polygon points={fillPoints} style={{ fill: series.color }} className="chart-area" />
        <polyline points={points} style={{ stroke: series.color }} />
        {hoveredPoint ? <><line x1={hoveredPoint.x} y1="8" x2={hoveredPoint.x} y2="92" className="chart-hover-line" /><circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="3.2" style={{ fill: series.color }} className="chart-hover-point" /></> : null}
      </svg>
      {hoveredPoint ? <motion.div className="chart-tooltip" style={{ left: `${hoveredPoint.x}%` }} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }}><strong>{hoveredPoint.value.toFixed(1)}</strong><span>Amostra {hoveredPoint.index + 1}</span></motion.div> : null}
      </div>
      <span className="chart-sr-value" aria-live="polite">{hoveredPoint ? `${series.label}: ${hoveredPoint.value.toFixed(1)}, amostra ${hoveredPoint.index + 1}` : ""}</span>
    </article>
  );
}

function TelemetryMap({ history, track, playbackPosition = null }: { history: Telemetry[]; track: FlightTrack | null; playbackPosition?: [number, number] | null }) {
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
    const latest = playbackPosition ?? routeCoordinates[routeCoordinates.length - 1];
    if (!markerRef.current) {
      const element = document.createElement("div");
      element.className = "drone-marker";
      markerRef.current = new maplibregl.Marker({ element }).setLngLat(latest).addTo(map);
    } else {
      markerRef.current.setLngLat(latest);
    }
    map.easeTo({ center: latest, duration: 500 });
  }, [routeCoordinates, playbackPosition]);

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

type ManagedUser = AuthUser & { is_active: boolean; invitation_status: "pending" | "sent" | "failed" | "accepted" };

type OperationalOccurrence = {
  id: string;
  code: string;
  title: string;
  status: string;
  address: string | null;
  external_source: string | null;
  external_id: string | null;
  started_at: string;
  mission_count: number;
};

type OperationalMission = {
  id: string;
  occurrence_id: string | null;
  occurrence_code: string | null;
  occurrence_title: string | null;
  title: string;
  objective: string;
  is_training: boolean;
  status: string;
  pilot_name: string | null;
  drone_serial: string | null;
  created_at: string;
  flight_count: number;
};

type OperationalFlight = {
  id: string;
  mission_id: string;
  sequence_number: number;
  status: "planned" | "active" | "completed" | "aborted";
  notes: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

type OperationalEvent = {
  id: number;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

function MissionManagementPage() {
  const { user } = useAuth();
  const reduceMotion = useReducedMotion();
  const canWrite = user.roles.some((role) => role === "Administrador" || role === "Operador");
  const [occurrences, setOccurrences] = React.useState<OperationalOccurrence[]>([]);
  const [missions, setMissions] = React.useState<OperationalMission[]>([]);
  const [flightsByMission, setFlightsByMission] = React.useState<Record<string, OperationalFlight[]>>({});
  const [expandedMission, setExpandedMission] = React.useState<string | null>(null);
  const [formMode, setFormMode] = React.useState<"occurrence" | "mission" | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [occurrenceCode, setOccurrenceCode] = React.useState("");
  const [occurrenceTitle, setOccurrenceTitle] = React.useState("");
  const [missionTitle, setMissionTitle] = React.useState("");
  const [missionObjective, setMissionObjective] = React.useState("");
  const [missionOccurrence, setMissionOccurrence] = React.useState("");
  const [trainingMission, setTrainingMission] = React.useState(false);
  const [addingFlight, setAddingFlight] = React.useState<string | null>(null);
  const [flightAction, setFlightAction] = React.useState<string | null>(null);

  const loadOperations = React.useCallback(async () => {
    setLoading(true);
    try {
      const [occurrenceResponse, missionResponse] = await Promise.all([
        authenticatedFetch("/api/v1/operations/occurrences", { cache: "no-store" }),
        authenticatedFetch("/api/v1/operations/missions", { cache: "no-store" }),
      ]);
      if (!occurrenceResponse.ok || !missionResponse.ok) throw new Error("Dados operacionais indisponíveis.");
      setOccurrences((await occurrenceResponse.json()) as OperationalOccurrence[]);
      const nextMissions = (await missionResponse.json()) as OperationalMission[];
      setMissions(nextMissions);
      const flightEntries = await Promise.all(nextMissions.map(async (mission) => {
        const response = await authenticatedFetch(`/api/v1/operations/missions/${mission.id}/flights`, { cache: "no-store" });
        return [mission.id, response.ok ? await response.json() as OperationalFlight[] : []] as const;
      }));
      setFlightsByMission(Object.fromEntries(flightEntries));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Não foi possível carregar as missões.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void loadOperations(); }, [loadOperations]);

  async function createOccurrence(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true); setMessage(null);
    try {
      const response = await authenticatedFetch("/api/v1/operations/occurrences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: occurrenceCode, title: occurrenceTitle }),
      });
      const result = (await response.json().catch(() => ({}))) as { detail?: string | Array<{ msg: string }> };
      if (!response.ok) {
        const detail = Array.isArray(result.detail) ? result.detail[0]?.msg : result.detail;
        throw new Error(detail ?? "Não foi possível criar a ocorrência.");
      }
      setOccurrenceCode(""); setOccurrenceTitle(""); setFormMode(null);
      setMessage("Ocorrência criada. Já pode associar uma missão.");
      await loadOperations();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Não foi possível criar a ocorrência.");
    } finally { setSubmitting(false); }
  }

  async function createMission(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true); setMessage(null);
    try {
      const response = await authenticatedFetch("/api/v1/operations/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: missionTitle,
          objective: missionObjective,
          occurrence_id: trainingMission ? null : missionOccurrence || null,
          is_training: trainingMission,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { detail?: string | Array<{ msg: string }> };
      if (!response.ok) {
        const detail = Array.isArray(result.detail) ? result.detail[0]?.msg : result.detail;
        throw new Error(detail ?? "Não foi possível criar a missão.");
      }
      setMissionTitle(""); setMissionObjective(""); setMissionOccurrence(""); setTrainingMission(false); setFormMode(null);
      setMessage("Missão criada em rascunho.");
      await loadOperations();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Não foi possível criar a missão.");
    } finally { setSubmitting(false); }
  }

  async function addFlight(missionId: string) {
    setAddingFlight(missionId); setMessage(null);
    try {
      const response = await authenticatedFetch(`/api/v1/operations/missions/${missionId}/flights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = (await response.json().catch(() => ({}))) as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Não foi possível adicionar o voo.");
      setMessage("Novo voo planeado e associado à missão.");
      await loadOperations();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Não foi possível adicionar o voo.");
    } finally { setAddingFlight(null); }
  }

  async function updateFlightStatus(flightId: string, nextStatus: "active" | "completed" | "aborted") {
    setFlightAction(flightId); setMessage(null);
    try {
      const response = await authenticatedFetch(`/api/v1/operations/flights/${flightId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const result = (await response.json().catch(() => ({}))) as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Não foi possível atualizar o voo.");
      setMessage(nextStatus === "active" ? "Voo iniciado. A telemetria nova ficará associada a este voo." : nextStatus === "completed" ? "Voo concluído." : "Voo abortado.");
      await loadOperations();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Não foi possível atualizar o voo.");
    } finally { setFlightAction(null); }
  }

  const statusLabel: Record<string, string> = {
    draft: "Rascunho", ready: "Pronta", active: "Em curso", completed: "Concluída",
    aborted: "Abortada", archived: "Arquivada", planned: "Planeada", in_progress: "Em curso",
  };

  return (
    <main className="app-shell">
      <AppSidebar active="missions" />
      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">Coordenação operacional</p><h1>Ocorrências e missões</h1></div>
          <span className="status-pill online">{missions.length} missões · {occurrences.length} ocorrências</span>
        </header>

        <div className="operations-notice" role="note">
          <ShieldCheck size={20} aria-hidden="true" />
          <div><strong>Integração de ocorrências preparada</strong><span>A sincronização com o SaaS externo será ativada quando estiver disponível a documentação oficial da API. Até lá, os registos são locais.</span></div>
        </div>

        {canWrite ? <div className="operations-toolbar" aria-label="Criar registo operacional">
          <button className={formMode === "occurrence" ? "active" : ""} type="button" onClick={() => setFormMode((current) => current === "occurrence" ? null : "occurrence")}><Plus size={18} />Nova ocorrência</button>
          <button className={formMode === "mission" ? "active" : ""} type="button" onClick={() => setFormMode((current) => current === "mission" ? null : "mission")}><PlaneTakeoff size={18} />Nova missão</button>
        </div> : null}

        <AnimatePresence initial={false}>
          {formMode === "occurrence" ? <motion.form className="panel operations-form" onSubmit={createOccurrence} initial={reduceMotion ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}>
            <div className="panel-heading"><ShieldAlert size={20} /><div><h2>Criar ocorrência local</h2><span>Poderá ser reconciliada com o SaaS externo mais tarde.</span></div></div>
            <div className="operations-form-grid"><label htmlFor="occurrence-code">Código<input id="occurrence-code" value={occurrenceCode} onChange={(event) => setOccurrenceCode(event.target.value)} placeholder="Ex.: OC-2026-001" required /></label><label htmlFor="occurrence-title">Designação<input id="occurrence-title" value={occurrenceTitle} onChange={(event) => setOccurrenceTitle(event.target.value)} placeholder="Incêndio urbano" required /></label></div>
            <button className="primary-action" type="submit" disabled={submitting}>{submitting ? <CircleDashed className="spin" size={18} /> : <Plus size={18} />}{submitting ? "A criar..." : "Criar ocorrência"}</button>
          </motion.form> : null}

          {formMode === "mission" ? <motion.form className="panel operations-form" onSubmit={createMission} initial={reduceMotion ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}>
            <div className="panel-heading"><PlaneTakeoff size={20} /><div><h2>Criar missão</h2><span>A missão começa como rascunho e pode conter vários voos.</span></div></div>
            <div className="operations-form-grid"><label htmlFor="mission-title">Designação<input id="mission-title" value={missionTitle} onChange={(event) => setMissionTitle(event.target.value)} placeholder="Reconhecimento aéreo" required /></label><label htmlFor="mission-occurrence">Ocorrência<select id="mission-occurrence" value={missionOccurrence} onChange={(event) => setMissionOccurrence(event.target.value)} disabled={trainingMission} required={!trainingMission}><option value="">Selecionar ocorrência</option>{occurrences.filter((item) => item.status === "active").map((item) => <option key={item.id} value={item.id}>{item.code} · {item.title}</option>)}</select></label><label className="operations-objective" htmlFor="mission-objective">Objetivo<textarea id="mission-objective" value={missionObjective} onChange={(event) => setMissionObjective(event.target.value)} rows={3} placeholder="Objetivo operacional e informação a recolher" required /></label></div>
            <label className="training-toggle"><input type="checkbox" checked={trainingMission} onChange={(event) => setTrainingMission(event.target.checked)} /><span><strong>Missão de treino</strong><small>Permite criar a missão sem ocorrência associada.</small></span></label>
            <button className="primary-action" type="submit" disabled={submitting}>{submitting ? <CircleDashed className="spin" size={18} /> : <PlaneTakeoff size={18} />}{submitting ? "A criar..." : "Criar missão"}</button>
          </motion.form> : null}
        </AnimatePresence>

        {message ? <p className="operations-message" role="status">{message}</p> : null}

        <section className="panel missions-list" aria-label="Missões registadas">
          <div className="panel-heading"><PlaneTakeoff size={20} /><div><h2>Missões registadas</h2><span>Cada missão agrega os seus voos, telemetria, streams e media.</span></div></div>
          {loading ? <div className="dashboard-empty"><CircleDashed className="spin" size={24} /><strong>A carregar missões</strong></div> : missions.length ? <div className="mission-table" role="table">
            {missions.map((mission) => <React.Fragment key={mission.id}><div className="mission-row" role="row"><div className="mission-main"><strong>{mission.title}</strong><span>{mission.is_training ? "Treino" : mission.occurrence_code ? `${mission.occurrence_code} · ${mission.occurrence_title}` : "Sem ocorrência"}</span><a className="mission-detail-link" href={`/missions/${mission.id}`}>Abrir detalhe</a></div><span className={`mission-status status-${mission.status}`}>{statusLabel[mission.status] ?? mission.status}</span><div className="flight-count"><Radio size={16} /><strong>{mission.flight_count}</strong><span>{mission.flight_count === 1 ? "voo" : "voos"}</span></div><time dateTime={mission.created_at}>{new Date(mission.created_at).toLocaleDateString("pt-PT")}</time><button className="secondary-action mission-view-action" type="button" onClick={() => setExpandedMission((current) => current === mission.id ? null : mission.id)} aria-expanded={expandedMission === mission.id}>{expandedMission === mission.id ? "Fechar" : "Ver voos"}</button>{canWrite ? <motion.button className="add-flight-action" type="button" onClick={() => void addFlight(mission.id)} disabled={addingFlight === mission.id} whileTap={{ scale: 0.97 }} title="Adicionar voo planeado"><Plus size={17} />{addingFlight === mission.id ? "A adicionar" : "Adicionar voo"}</motion.button> : null}</div>{expandedMission === mission.id ? <motion.div className="flight-list" initial={reduceMotion ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}><div className="flight-list-heading"><strong>Voos desta missão</strong><span>{mission.objective}</span></div>{(flightsByMission[mission.id] ?? []).map((flight) => <div className="flight-row" key={flight.id}><div><strong>Voo {flight.sequence_number}</strong><span>{flight.started_at ? new Date(flight.started_at).toLocaleString("pt-PT") : "Ainda não iniciado"}</span></div><span className={`mission-status status-${flight.status}`}>{statusLabel[flight.status]}</span>{canWrite && flight.status === "planned" ? <motion.button className="primary-action compact-action" type="button" onClick={() => void updateFlightStatus(flight.id, "active")} disabled={flightAction === flight.id} whileTap={{ scale: 0.97 }}><PlaneTakeoff size={16} />Iniciar voo</motion.button> : null}{canWrite && flight.status === "active" ? <div className="flight-actions"><motion.button className="secondary-action compact-action" type="button" onClick={() => void updateFlightStatus(flight.id, "completed")} disabled={flightAction === flight.id} whileTap={{ scale: 0.97 }}><Check size={16} />Concluir</motion.button><motion.button className="danger-action compact-action" type="button" onClick={() => void updateFlightStatus(flight.id, "aborted")} disabled={flightAction === flight.id} whileTap={{ scale: 0.97 }}><ShieldAlert size={16} />Abortar</motion.button></div> : null}</div>)}</motion.div> : null}</React.Fragment>)}
          </div> : <div className="dashboard-empty"><PlaneTakeoff size={26} /><strong>Sem missões registadas</strong><span>Crie a primeira ocorrência e associe-lhe uma missão operacional.</span></div>}
        </section>
      </section>
    </main>
  );
}

function MissionDetailPage({ missionId }: { missionId: string }) {
  const reduceMotion = useReducedMotion();
  const [mission, setMission] = React.useState<OperationalMission | null>(null);
  const [flights, setFlights] = React.useState<OperationalFlight[]>([]);
  const [events, setEvents] = React.useState<OperationalEvent[]>([]);
  const [tracks, setTracks] = React.useState<HistoricalTrack[]>([]);
  const [telemetry, setTelemetry] = React.useState<Telemetry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(null);
      try {
        const missionsResponse = await authenticatedFetch("/api/v1/operations/missions", { cache: "no-store" });
        if (!missionsResponse.ok) throw new Error("Não foi possível carregar as missões.");
        const missions = await missionsResponse.json() as OperationalMission[];
        const selected = missions.find((item) => item.id === missionId);
        if (!selected) throw new Error("Missão não encontrada.");
        const [flightsResponse, eventsResponse] = await Promise.all([
          authenticatedFetch(`/api/v1/operations/missions/${missionId}/flights`, { cache: "no-store" }),
          authenticatedFetch(`/api/v1/operations/missions/${missionId}/events`, { cache: "no-store" }),
        ]);
        let nextTracks: HistoricalTrack[] = [];
        let nextTelemetry: Telemetry[] = [];
        if (selected.drone_serial) {
          const [tracksResponse, telemetryResponse] = await Promise.all([
            authenticatedFetch(`/api/v1/dji/mqtt/telemetry/${selected.drone_serial}/tracks?limit=20`, { cache: "no-store" }),
            authenticatedFetch(`/api/v1/dji/mqtt/telemetry/${selected.drone_serial}/history?limit=500`, { cache: "no-store" }),
          ]);
          nextTracks = tracksResponse.ok ? await tracksResponse.json() as HistoricalTrack[] : [];
          nextTelemetry = telemetryResponse.ok ? await telemetryResponse.json() as Telemetry[] : [];
        }
        if (!active) return;
        setMission(selected);
        setFlights(flightsResponse.ok ? await flightsResponse.json() as OperationalFlight[] : []);
        setEvents(eventsResponse.ok ? await eventsResponse.json() as OperationalEvent[] : []);
        setTracks(nextTracks); setTelemetry(nextTelemetry);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Não foi possível carregar a missão.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [missionId]);

  if (loading) return <main className="app-shell"><AppSidebar active="missions" /><section className="workspace"><div className="dashboard-empty"><CircleDashed className="spin" size={26} /><strong>A carregar detalhe da missão</strong></div></section></main>;
  if (error || !mission) return <main className="app-shell"><AppSidebar active="missions" /><section className="workspace access-denied"><ShieldAlert size={36} /><h1>Missão indisponível</h1><p>{error ?? "Não foi possível localizar esta missão."}</p><a className="primary-action" href="/missions">Voltar às missões</a></section></main>;

  const orderedTelemetry = telemetry.slice().sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  const latest = orderedTelemetry[orderedTelemetry.length - 1];
  const selectedTrack = tracks[0] ?? null;
  const statusLabel: Record<string, string> = { draft: "Rascunho", active: "Em curso", completed: "Concluída", aborted: "Abortada", planned: "Planeado" };
  const eventLabel = (event: OperationalEvent) => event.event_type === "mission.created" ? "Missão criada" : event.event_type === "flight.created" ? "Voo planeado" : event.event_type === "flight.status_changed" ? `Voo ${statusLabel[event.to_status ?? ""]?.toLowerCase() ?? "atualizado"}` : event.event_type;

  return <main className="app-shell"><AppSidebar active="missions" /><section className="workspace mission-detail-page">
    <header className="topbar"><div><a className="back-link" href="/missions">← Missões</a><p className="eyebrow">Detalhe operacional</p><h1>{mission.title}</h1><span className="mission-subtitle">{mission.is_training ? "Missão de treino" : `${mission.occurrence_code ?? "Sem ocorrência"} · ${mission.occurrence_title ?? ""}`}</span></div><span className={`mission-status status-${mission.status}`}>{statusLabel[mission.status] ?? mission.status}</span></header>
    <section className="mission-detail-metrics" aria-label="Resumo da missão"><div><span>Voos</span><strong>{flights.length}</strong></div><div><span>Telemetria</span><strong>{orderedTelemetry.length}</strong></div><div><span>Bateria atual</span><strong>{latest?.battery_percent != null ? `${latest.battery_percent}%` : "--"}</strong></div><div><span>Altitude máxima</span><strong>{orderedTelemetry.length ? `${Math.max(...orderedTelemetry.map((point) => point.altitude_m ?? 0)).toFixed(1)} m` : "--"}</strong></div></section>
    <div className="mission-detail-grid"><section className="panel mission-map-panel"><div className="panel-heading"><MapPin size={20} /><div><h2>Trajeto e posição</h2><span>{mission.drone_serial ? `Aeronave ${mission.drone_serial}` : "Sem aeronave atribuída"}</span></div></div>{selectedTrack || orderedTelemetry.length ? <TelemetryMap history={orderedTelemetry} track={selectedTrack} /> : <div className="map-empty"><MapPin size={28} /><strong>Ainda sem posição GPS</strong><span>O trajeto aparecerá quando o voo transmitir coordenadas.</span></div>}</section><section className="panel mission-flights-panel"><div className="panel-heading"><PlaneTakeoff size={20} /><div><h2>Voos da missão</h2><span>{mission.objective}</span></div></div>{flights.length ? <div className="detail-flight-list">{flights.map((flight) => <div className="detail-flight-row" key={flight.id}><div><strong>Voo {flight.sequence_number}</strong><span>{flight.started_at ? new Date(flight.started_at).toLocaleString("pt-PT") : "Planeado"}</span></div><span className={`mission-status status-${flight.status}`}>{statusLabel[flight.status] ?? flight.status}</span></div>)}</div> : <p className="empty-state">Ainda não existem voos associados.</p>}</section></div>
    <TelemetryCharts points={orderedTelemetry} />
    <section className="panel mission-events-panel"><div className="panel-heading"><Activity size={20} /><div><h2>Timeline da missão</h2><span>Registo operacional e auditoria</span></div></div>{events.length ? <div className="mission-event-list">{events.map((event, index) => <motion.div className="mission-event" key={event.id} initial={reduceMotion ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.04 }}><CheckCircle2 size={18} /><div><strong>{eventLabel(event)}</strong><span>{new Date(event.created_at).toLocaleString("pt-PT")}{event.reason ? ` · ${event.reason}` : ""}</span></div></motion.div>)}</div> : <p className="empty-state">A timeline será preenchida quando a missão tiver atividade.</p>}</section>
  </section></main>;
}

function UserManagementPage() {
  const [users, setUsers] = React.useState<ManagedUser[]>([]);
  const [email, setEmail] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [roles, setRoles] = React.useState<string[]>(["Observador"]);
  const [message, setMessage] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [resendingUserId, setResendingUserId] = React.useState<string | null>(null);
  const roleOptions = ["Administrador", "Operador", "Piloto", "Observador"];

  const loadUsers = React.useCallback(async () => {
    const response = await authenticatedFetch("/api/v1/users", { cache: "no-store" });
    if (response.ok) setUsers((await response.json()) as ManagedUser[]);
  }, []);

  React.useEffect(() => { void loadUsers(); }, [loadUsers]);

  function toggleRole(role: string) {
    setRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role]);
  }

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    if (!roles.length) { setMessage("Selecione pelo menos um perfil."); return; }
    setSubmitting(true); setMessage(null);
    try {
      const response = await authenticatedFetch("/api/v1/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, full_name: fullName, roles }) });
      const result = (await response.json().catch(() => ({}))) as { detail?: string | Array<{ msg: string }> };
      if (!response.ok) {
        const detail = Array.isArray(result.detail) ? result.detail[0]?.msg : result.detail;
        throw new Error(detail ?? "Não foi possível criar o utilizador.");
      }
      const created = result as ManagedUser;
      setEmail(""); setFullName(""); setRoles(["Observador"]);
      setMessage(created.invitation_status === "sent" ? "Utilizador criado e convite enviado por email." : "Utilizador criado, mas o email falhou. Pode reenviar o convite na lista.");
      await loadUsers();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Não foi possível criar o utilizador.");
    } finally { setSubmitting(false); }
  }

  async function resendInvitation(userId: string) {
    setResendingUserId(userId); setMessage(null);
    try {
      const response = await authenticatedFetch(`/api/v1/users/${userId}/invite`, { method: "POST" });
      const result = (await response.json().catch(() => ({}))) as ManagedUser & { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Não foi possível reenviar o convite.");
      setMessage(result.invitation_status === "sent" ? "Convite reenviado por email." : "O novo convite foi criado, mas o envio de email falhou.");
      await loadUsers();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Não foi possível reenviar o convite."); }
    finally { setResendingUserId(null); }
  }

  return (
    <main className="app-shell">
      <AppSidebar active="users" />
      <section className="workspace">
        <header className="topbar"><div><p className="eyebrow">Administração</p><h1>Utilizadores e permissões</h1></div><span className="status-pill online">{users.length} contas</span></header>
        <section className="users-layout">
          <form className="panel user-form" onSubmit={createUser}>
            <div className="panel-heading"><UserRound size={20} /><div><h2>Novo utilizador</h2><span>Crie uma conta e atribua os perfis necessários.</span></div></div>
            <label htmlFor="user-name">Nome completo</label><input id="user-name" value={fullName} onChange={(event) => setFullName(event.target.value)} minLength={2} required />
            <label htmlFor="user-email">Email institucional</label><input id="user-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <p className="invite-note"><Mail size={18} />O utilizador receberá um link seguro para definir a própria password.</p>
            <fieldset><legend>Perfis</legend><div className="role-options">{roleOptions.map((role) => <label key={role}><input type="checkbox" checked={roles.includes(role)} onChange={() => toggleRole(role)} /><span>{role}</span></label>)}</div></fieldset>
            {message ? <p className="user-form-message" role="status">{message}</p> : null}
            <button className="primary-action" type="submit" disabled={submitting}>{submitting ? <CircleDashed className="spin" size={18} /> : <Users size={18} />}{submitting ? "A criar..." : "Criar utilizador"}</button>
          </form>
          <section className="panel users-list" aria-label="Utilizadores registados">
            <div className="panel-heading"><Users size={20} /><div><h2>Contas registadas</h2><span>Perfis atualmente atribuídos</span></div></div>
            <div className="users-table" role="table">{users.map((item) => <div className="user-row" role="row" key={item.id}><div className="user-avatar" aria-hidden="true">{item.full_name.slice(0, 2).toUpperCase()}</div><div><strong>{item.full_name}</strong><span>{item.email}</span></div><div className="role-badges">{item.roles.map((role) => <span key={role}>{role}</span>)}</div><span className={`service-state ${item.is_active ? "is-online" : item.invitation_status === "failed" ? "is-error" : "is-offline"}`}><span />{item.is_active ? "Ativo" : item.invitation_status === "sent" ? "Convite enviado" : item.invitation_status === "failed" ? "Email falhou" : "Pendente"}</span>{!item.is_active ? <motion.button className="icon-action" type="button" onClick={() => void resendInvitation(item.id)} disabled={resendingUserId === item.id} whileTap={{ scale: 0.96 }} title="Reenviar convite" aria-label={`Reenviar convite para ${item.full_name}`}>{resendingUserId === item.id ? <CircleDashed className="spin" size={17} /> : <Mail size={17} />}</motion.button> : null}</div>)}</div>
          </section>
        </section>
      </section>
    </main>
  );
}

function PilotPage() {
  const { user, logout } = useAuth();
  const reduceMotion = useReducedMotion();
  const [config, setConfig] = React.useState<JsBridgeConfig | null>(null);
  const [, setSteps] = React.useState<SetupStep[]>(setupSteps);
  const [mqttState, setMqttState] = React.useState<"unknown" | "connected" | "disconnected">(
    "unknown",
  );
  const backendMqttConfirmed = React.useRef(false);
  const setupStarted = React.useRef(false);
  const [pilotSessionId, setPilotSessionId] = React.useState<string | null>(null);
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

    authenticatedFetch("/api/v1/dji/pilot/jsbridge-config", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<JsBridgeConfig>;
      })
      .then(setConfig)
      .catch((err: Error) => setError(err.message));
  }, []);

  React.useEffect(() => {
    if (!config || setupStarted.current) return;
    setupStarted.current = true;
    void runPilotSetup();
  }, [config]);

  React.useEffect(() => {
    if (!pilotSessionId) return;
    const timer = window.setInterval(() => {
      void authenticatedFetch(
        `/api/v1/dji/pilot/operator-sessions/${pilotSessionId}/heartbeat`,
        { method: "POST" },
      );
    }, 30000);
    return () => window.clearInterval(timer);
  }, [pilotSessionId]);

  React.useEffect(() => {
    let active = true;
    async function refreshTelemetryState() {
      const status = await getBackendMqttStatus();
      if (!active || !status) return;
      const hasRecentMessage = Object.values(status.devices).some((device) => {
        if (!device.last_message_at) return false;
        return Date.now() - new Date(device.last_message_at).getTime() < 20000;
      });
      setMqttState(status.connected && hasRecentMessage ? "connected" : "disconnected");
    }
    void refreshTelemetryState();
    const timer = window.setInterval(refreshTelemetryState, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
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
      const gatewaySn =
        parseBridgeData<string>(window.djiBridge?.platformGetRemoteControllerSN?.()) ?? "--";
      const detectedAircraftSn =
        parseBridgeData<string>(window.djiBridge?.platformGetAircraftSN?.()) ?? "--";
      if (gatewaySn !== "--") {
        const sessionResponse = await authenticatedFetch("/api/v1/dji/pilot/operator-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            controller_sn: gatewaySn,
            aircraft_sn: detectedAircraftSn === "--" ? null : detectedAircraftSn,
          }),
        });
        if (!sessionResponse.ok) throw new Error("Não foi possível registar o piloto neste comando.");
        const operatorSession = (await sessionResponse.json()) as { id: string };
        setPilotSessionId(operatorSession.id);
      }

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido na configuracao Pilot.");
    } finally {
      setIsConfiguring(false);
    }
  }

  async function endPilotSession() {
    if (pilotSessionId) {
      await authenticatedFetch(`/api/v1/dji/pilot/operator-sessions/${pilotSessionId}/close`, {
        method: "POST",
      }).catch(() => undefined);
    }
    await logout();
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
        <div className="pilot-card-header">
          <div className="pilot-brand"><img src="/ahbvc.png" alt="AHBVC" /><div><p className="eyebrow">DJI Pilot 2 · AHBVC</p><h1 id="pilot-title">{productName}</h1></div></div>
          <div className="pilot-actions"><ThemeToggle compact /><button className="icon-action" type="button" onClick={() => void endPilotSession()} aria-label="Terminar sessão" title="Terminar sessão"><LogOut size={18} /></button></div>
        </div>
        <p className="pilot-identity"><UserRound size={18} />{user.full_name}<span>{user.roles.join(" · ")}</span></p>

        <div className="pilot-badges" aria-live="polite">
          <span className={`pilot-badge ${mqttState === "connected" ? "ok" : mqttState === "disconnected" ? "error" : "pending"}`}><Wifi size={20} />{mqttState === "connected" ? "Telemetria a receber" : mqttState === "disconnected" ? "Sem telemetria" : "A ligar telemetria"}</span>
          <span className={`pilot-badge ${window.djiBridge ? "ok" : "error"}`}><Radio size={20} />{window.djiBridge ? "DJI Pilot ligado" : "DJI Pilot indisponível"}</span>
          <span className={`pilot-badge ${pilotSessionId ? "ok" : "pending"}`}><UserRound size={20} />{pilotSessionId ? "Piloto registado" : "A registar piloto"}</span>
        </div>
        {error ? <p className="pilot-warning" role="alert"><ShieldAlert size={18} />{error}</p> : null}
        {isConfiguring && !error ? <p className="pilot-progress"><CircleDashed className="spin" size={18} />A estabelecer ligação segura...</p> : null}
      </motion.section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

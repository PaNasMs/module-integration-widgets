import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import {
  mdiArrowTopRight,
  mdiCogOutline,
  mdiHomeAssistant,
  mdiServerNetwork,
  mdiNas,
} from "@mdi/js";
import { Button, DialogContent, Icon, Notice, bytes } from "@panasms/ui";
import { registerModule } from "@panasms/runtime";
import { request } from "@panasms/client";
import { registerTranslations, translator } from "@panasms/i18n";
import en from "./locales/en.json";
import ru from "./locales/ru.json";
import uk from "./locales/uk.json";
import "./integration-widgets.css";

registerTranslations("integration-widgets", { en, ru, uk });
const tr = translator("integration-widgets");
type Provider = "proxmox" | "synology" | "home-assistant";
type Connection = {
  id: string;
  type: Provider;
  name: string;
  url: string;
  username?: string;
  skipTLSVerify?: boolean;
};
type Form = Connection & { secret: string };
type Volume = { id: string; total: number; used: number; status: string };
type Metric = { id: string; label: string; value: string; unit?: string };
type Snapshot = {
  type: Provider;
  cpu?: number;
  memoryUsed?: number;
  memoryTotal?: number;
  nodes?: number;
  vms?: number;
  vmsRunning?: number;
  containers?: number;
  containersRunning?: number;
  volumes?: Volume[];
  metrics?: Metric[];
  observedAt: string;
};
const endpoint = "module-api/integration-widgets/";
const connections = () => request<Connection[]>(endpoint + "connections");
const snapshot = (id: string, config: Record<string, string> = {}) => {
  const query = new URLSearchParams({ id });
  for (const key of ["primary", "secondary", "tertiary"])
    if (config[key]) query.set(key, config[key]);
  return request<Snapshot>(endpoint + "snapshot?" + query);
};
const titles: Record<Provider, string> = {
  proxmox: "proxmox",
  synology: "synology",
  "home-assistant": "homeAssistant",
};
const icons: Record<Provider, string> = {
  proxmox: mdiServerNetwork,
  synology: mdiNas,
  "home-assistant": mdiHomeAssistant,
};
const visible = (config: Record<string, string>, key: string) =>
  config[key] !== "false";
const percent = (value?: number) =>
  value == null || !Number.isFinite(value) ? "—" : `${Math.round(value)}%`;

function Meter({
  label,
  value,
  detail,
}: {
  label: string;
  value?: number;
  detail?: string;
}) {
  return (
    <div className="integration-meter">
      <div>
        <span>{label}</span>
        <strong>{percent(value)}</strong>
      </div>
      <progress
        max={100}
        value={value == null ? undefined : Math.max(0, Math.min(100, value))}
        aria-label={label}
      />
      {detail && <small>{detail}</small>}
    </div>
  );
}

function Card({
  provider,
  config = {},
  editing,
}: {
  provider: Provider;
  config?: Record<string, string>;
  editing?: boolean;
}) {
  const all = useQuery({
    queryKey: ["integration-widgets", "connections"],
    queryFn: connections,
    refetchInterval: 60000,
  });
  const connection = all.data?.find(
    (item) => item.id === config.connectionId && item.type === provider,
  );
  const data = useQuery({
    queryKey: [
      "integration-widgets",
      "snapshot",
      connection?.id,
      config.primary,
      config.secondary,
      config.tertiary,
    ],
    queryFn: () => snapshot(connection!.id, config),
    enabled: !!connection,
    refetchInterval: 60000,
    retry: false,
  });
  const selectedVolumes = config.volumes?.split(",").filter(Boolean);
  const volumes = (data.data?.volumes ?? []).filter(
    (volume) => !selectedVolumes?.length || selectedVolumes.includes(volume.id),
  );
  const memoryPercent = data.data?.memoryTotal
    ? (data.data.memoryUsed! / data.data.memoryTotal) * 100
    : undefined;
  const status = !config.connectionId
    ? tr("notConfigured")
    : !connection && !all.isPending
      ? tr("notConfigured")
      : data.error
        ? data.error.message === "Authentication failed"
          ? tr("authenticationFailed")
          : data.error.message === "Metric unavailable"
            ? tr("metricUnavailable")
            : tr("unavailable")
        : data.isPending
          ? "…"
          : "";
  return (
    <div className="integration-card">
      <div className="integration-head">
        <span className="integration-icon">
          <Icon path={icons[provider]} size={20} />
        </span>
        <div>
          <small>{tr(titles[provider])}</small>
          <strong>{connection?.name ?? tr(titles[provider])}</strong>
        </div>
        {!editing && connection && (
          <a
            href={connection.url}
            target="_blank"
            rel="noopener noreferrer"
            title={tr("openService")}
            aria-label={`${tr("openService")}: ${connection.name}`}
          >
            <Icon path={mdiArrowTopRight} size={18} />
          </a>
        )}
      </div>
      {status ? (
        <p className="integration-status" role="status">
          {status}
        </p>
      ) : provider === "proxmox" ? (
        <>
          <div className="integration-meters">
            {visible(config, "showCPU") && (
              <Meter label={tr("cpu")} value={data.data?.cpu} />
            )}
            {visible(config, "showMemory") && (
              <Meter
                label={tr("memory")}
                value={memoryPercent}
                detail={
                  data.data?.memoryTotal
                    ? `${bytes(data.data.memoryUsed ?? 0)} / ${bytes(data.data.memoryTotal)}`
                    : undefined
                }
              />
            )}
          </div>
          <div className="integration-summary">
            {visible(config, "showNodes") && (
              <span>
                {tr("nodes")} <b>{data.data?.nodes ?? "—"}</b>
              </span>
            )}
            {visible(config, "showVMs") && (
              <span>
                {tr("vms")}{" "}
                <b>
                  {data.data?.vmsRunning ?? "—"}/{data.data?.vms ?? "—"}
                </b>
              </span>
            )}
            {visible(config, "showContainers") && (
              <span>
                {tr("containers")}{" "}
                <b>
                  {data.data?.containersRunning ?? "—"}/
                  {data.data?.containers ?? "—"}
                </b>
              </span>
            )}
          </div>
        </>
      ) : provider === "synology" ? (
        <>
          <div className="integration-synology-summary">
            {visible(config, "showCPU") && data.data?.cpu != null && (
              <span>
                {tr("cpu")} <strong>{percent(data.data.cpu)}</strong>
              </span>
            )}
            {visible(config, "showMemory") &&
              data.data?.metrics?.find(
                (metric) => metric.label === "memory",
              ) && (
                <span>
                  {tr("memory")}{" "}
                  <strong>
                    {
                      data.data.metrics.find(
                        (metric) => metric.label === "memory",
                      )!.value
                    }
                    %
                  </strong>
                </span>
              )}
          </div>
          <div className="integration-volumes" aria-label={tr("volumes")}>
            {volumes.length ? (
              volumes.map((volume) => (
                <div
                  className={`integration-volume ${(volume.total > 0 && volume.used / volume.total >= 0.8) || volume.status !== "normal" ? "warning" : ""}`}
                  key={volume.id}
                >
                  <div>
                    <span>{volume.id}</span>
                    <strong>
                      {volume.total
                        ? `${Math.round((volume.used / volume.total) * 100)}%`
                        : "—"}
                    </strong>
                  </div>
                  <progress
                    max={volume.total || 1}
                    value={volume.used}
                    aria-label={volume.id}
                  />
                  <small>
                    {volume.total
                      ? `${bytes(volume.used)} / ${bytes(volume.total)}`
                      : tr("metricUnavailable")}{" "}
                    · {volume.status}
                  </small>
                </div>
              ))
            ) : (
              <p className="muted">{tr("noVolumes")}</p>
            )}
          </div>
        </>
      ) : (
        <div className="integration-ha-metrics">
          {data.data?.metrics?.length ? (
            data.data.metrics.map((metric, index) => (
              <div key={metric.id} className={index === 0 ? "primary" : ""}>
                <small>{metric.label}</small>
                <strong>
                  {metric.value === "unavailable" || metric.value === "unknown"
                    ? "—"
                    : metric.value}{" "}
                  <span>{metric.unit}</span>
                </strong>
              </div>
            ))
          ) : (
            <p className="muted">{tr("metricUnavailable")}</p>
          )}
        </div>
      )}
      {data.data && (
        <time
          dateTime={data.data.observedAt}
          title={new Date(data.data.observedAt).toLocaleString()}
          className="integration-updated"
        >
          {tr("lastUpdated")}{" "}
          {new Date(data.data.observedAt).toLocaleTimeString()}
        </time>
      )}
    </div>
  );
}

function Configure({
  provider,
  value,
  onChange,
}: {
  provider: Provider;
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}) {
  const all = useQuery({
    queryKey: ["integration-widgets", "connections"],
    queryFn: connections,
  });
  const matching =
    all.data?.filter((connection) => connection.type === provider) ?? [];
  const selected = matching.find(
    (connection) => connection.id === value.connectionId,
  );
  const available = useQuery({
    queryKey: ["integration-widgets", "volumes", selected?.id],
    queryFn: () => snapshot(selected!.id),
    enabled: provider === "synology" && !!selected,
    retry: false,
  });
  const set = (key: string, next: string) =>
    onChange({ ...value, [key]: next });
  return (
    <div className="integration-form">
      <p className="muted">{tr("configure")}</p>
      <label className="field">
        {tr("connection")}
        <select
          value={value.connectionId ?? ""}
          onChange={(event) => set("connectionId", event.target.value)}
        >
          <option value="">{tr("chooseConnection")}</option>
          {matching.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name}
            </option>
          ))}
        </select>
      </label>
      {!matching.length && <Notice>{tr("noConnections")}</Notice>}
      {provider === "proxmox" && (
        <div className="integration-options">
          {(["CPU", "Memory", "Nodes", "VMs", "Containers"] as const).map(
            (part) => (
              <label className="check" key={part}>
                <input
                  type="checkbox"
                  checked={visible(value, "show" + part)}
                  onChange={(event) =>
                    set("show" + part, String(event.target.checked))
                  }
                />
                {tr("show" + part)}
              </label>
            ),
          )}
        </div>
      )}
      {provider === "synology" && (
        <div className="integration-options">
          {(["CPU", "Memory"] as const).map((part) => (
            <label className="check" key={part}>
              <input
                type="checkbox"
                checked={visible(value, "show" + part)}
                onChange={(event) =>
                  set("show" + part, String(event.target.checked))
                }
              />
              {tr("show" + part)}
            </label>
          ))}
        </div>
      )}
      {provider === "synology" && selected && (
        <div className="integration-options">
          <strong>{tr("selectVolumes")}</strong>
          <label className="check">
            <input
              type="checkbox"
              checked={!value.volumes}
              onChange={(event) =>
                set(
                  "volumes",
                  event.target.checked
                    ? ""
                    : (available.data?.volumes ?? [])
                        .map((item) => item.id)
                        .join(","),
                )
              }
            />
            {tr("allVolumes")}
          </label>
          {available.data?.volumes?.map((volume) => (
            <label className="check" key={volume.id}>
              <input
                type="checkbox"
                checked={
                  !value.volumes || value.volumes.split(",").includes(volume.id)
                }
                onChange={(event) => {
                  const current = value.volumes
                    ? value.volumes.split(",")
                    : (available.data?.volumes ?? []).map((item) => item.id);
                  const next = event.target.checked
                    ? [...current, volume.id]
                    : current.filter((id) => id !== volume.id);
                  set("volumes", next.length ? next.join(",") : "-");
                }}
              />
              {volume.id}
            </label>
          ))}
        </div>
      )}
      {provider === "home-assistant" && (
        <>
          {(["primary", "secondary", "tertiary"] as const).map((part) => (
            <label className="field" key={part}>
              {tr(part)}
              <input
                value={value[part] ?? ""}
                placeholder="sensor.living_room_temperature"
                onChange={(event) => set(part, event.target.value.trim())}
              />
            </label>
          ))}
          <p className="muted">{tr("haHelp")}</p>
        </>
      )}
    </div>
  );
}

const empty = (): Form => ({
  id: "",
  type: "proxmox",
  name: "",
  url: "",
  username: "",
  secret: "",
  skipTLSVerify: false,
});
function Settings() {
  const queryClient = useQueryClient();
  const all = useQuery({
    queryKey: ["integration-widgets", "connections"],
    queryFn: connections,
  });
  const [form, setForm] = useState<Form | null>(null);
  const [original, setOriginal] = useState<Form | null>(null);
  const [tested, setTested] = useState("");
  const [removing, setRemoving] = useState<Connection | null>(null);
  const save = useMutation({
    mutationFn: (value: Form) =>
      request<Connection>(endpoint + "connections", "POST", value),
    onSuccess: () => {
      setForm(null);
      void queryClient.invalidateQueries({ queryKey: ["integration-widgets"] });
    },
  });
  const testConnection = useMutation({
    mutationFn: (value: Form) =>
      request<{ ok: boolean }>(endpoint + "connections/test", "POST", value),
    onMutate: (value) => setTested(JSON.stringify(value)),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      request(endpoint + "connections/" + encodeURIComponent(id), "DELETE"),
    onSuccess: () => {
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: ["integration-widgets"] });
    },
  });
  return (
    <section className="surface integration-settings">
      <div className="integration-settings-head">
        <div>
          <h2>{tr("connections")}</h2>
          <p className="muted">{tr("description")}</p>
        </div>
        <Button
          className="primary"
          onClick={() => {
            const next = empty();
            setForm(next);
            setOriginal(next);
            testConnection.reset();
          }}
        >
          {tr("addConnection")}
        </Button>
      </div>
      {all.error && <Notice error>{all.error.message}</Notice>}
      {!all.data?.length && !all.isPending && (
        <Notice>{tr("noConnections")}</Notice>
      )}
      <div className="integration-connection-list">
        {all.data?.map((connection) => (
          <div key={connection.id} className="integration-connection">
            <span className="integration-icon">
              <Icon path={icons[connection.type]} size={20} />
            </span>
            <div>
              <strong>{connection.name}</strong>
              <small>
                {tr(titles[connection.type])} · {connection.url}
              </small>
            </div>
            <Button
              onClick={() => {
                const next = { ...connection, secret: "" };
                setForm(next);
                setOriginal(next);
                testConnection.reset();
              }}
            >
              {tr("editConnection")}
            </Button>
            <Button onClick={() => setRemoving(connection)}>
              {tr("delete")}
            </Button>
          </div>
        ))}
      </div>
      <Dialog.Root
        open={!!form}
        onOpenChange={(open) => !open && !save.isPending && setForm(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <DialogContent
            className="settings-dialog"
            busy={save.isPending || testConnection.isPending}
            dirty={!!form && JSON.stringify(form) !== JSON.stringify(original)}
            header={
              <>
                <Dialog.Title>
                  {form?.id ? tr("editConnection") : tr("addConnection")}
                </Dialog.Title>
                <Dialog.Description>{tr("description")}</Dialog.Description>
              </>
            }
            footer={
              <div className="actions">
                <Button
                  disabled={save.isPending || testConnection.isPending}
                  onClick={() => setForm(null)}
                >
                  {tr("cancel")}
                </Button>
                <Button
                  disabled={
                    save.isPending ||
                    testConnection.isPending ||
                    !form?.name ||
                    !form?.url ||
                    (!form.id && !form.secret)
                  }
                  onClick={() => form && testConnection.mutate(form)}
                >
                  {tr("test")}
                </Button>
                <Button
                  className="primary"
                  disabled={
                    save.isPending ||
                    testConnection.isPending ||
                    !form?.name ||
                    !form?.url ||
                    (!form.id && !form.secret)
                  }
                  onClick={() => form && save.mutate(form)}
                >
                  {tr("save")}
                </Button>
              </div>
            }
          >
            {form && (
              <div className="integration-form">
                <label className="field">
                  {tr("type")}
                  <select
                    value={form.type}
                    disabled={!!form.id}
                    onChange={(event) =>
                      setForm({ ...form, type: event.target.value as Provider })
                    }
                  >
                    <option value="proxmox">{tr("proxmox")}</option>
                    <option value="synology">{tr("synology")}</option>
                    <option value="home-assistant">
                      {tr("homeAssistant")}
                    </option>
                  </select>
                </label>
                <label className="field">
                  {tr("name")}
                  <input
                    required
                    maxLength={80}
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  {tr("address")}
                  <input
                    required
                    type="url"
                    value={form.url}
                    placeholder="https://service.local"
                    onChange={(event) =>
                      setForm({ ...form, url: event.target.value })
                    }
                  />
                </label>
                {form.url.toLowerCase().startsWith("http://") && (
                  <Notice>{tr("plainHttp")}</Notice>
                )}
                {form.type === "synology" && (
                  <label className="field">
                    {tr("username")}
                    <input
                      required
                      value={form.username ?? ""}
                      onChange={(event) =>
                        setForm({ ...form, username: event.target.value })
                      }
                    />
                  </label>
                )}
                <label className="field">
                  {tr("secret")}
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={form.secret}
                    onChange={(event) =>
                      setForm({ ...form, secret: event.target.value })
                    }
                  />
                  {form.id && <small>{tr("secretKeep")}</small>}
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!form.skipTLSVerify}
                    onChange={(event) =>
                      setForm({ ...form, skipTLSVerify: event.target.checked })
                    }
                  />
                  {tr("tls")}
                </label>
                {form.skipTLSVerify && <p className="muted">{tr("tlsHelp")}</p>}
                {save.error && (
                  <Notice error>
                    {tr("errorSaving")}: {save.error.message}
                  </Notice>
                )}
                {form &&
                  tested === JSON.stringify(form) &&
                  testConnection.isSuccess && (
                    <Notice>{tr("testSuccess")}</Notice>
                  )}
                {form &&
                  tested === JSON.stringify(form) &&
                  testConnection.error && (
                    <Notice error>
                      {tr("testError")}:{" "}
                      {testConnection.error.message === "Authentication failed"
                        ? tr("authenticationFailed")
                        : testConnection.error.message === "Metric unavailable"
                          ? tr("metricUnavailable")
                          : tr("unavailable")}
                    </Notice>
                  )}
              </div>
            )}
          </DialogContent>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={!!removing}
        onOpenChange={(open) => !open && !remove.isPending && setRemoving(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <DialogContent
            className="settings-dialog"
            intent="confirm"
            busy={remove.isPending}
            header={
              <>
                <Dialog.Title>{tr("delete")}</Dialog.Title>
                <Dialog.Description>{tr("deleteConfirm")}</Dialog.Description>
              </>
            }
            footer={
              <div className="actions">
                <Button
                  disabled={remove.isPending}
                  onClick={() => setRemoving(null)}
                >
                  {tr("cancel")}
                </Button>
                <Button
                  disabled={remove.isPending}
                  onClick={() => removing && remove.mutate(removing.id)}
                >
                  {tr("delete")}
                </Button>
              </div>
            }
          >
            {removing?.name}
            {remove.error && <Notice error>{tr("errorDeleting")}</Notice>}
          </DialogContent>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}

registerModule({
  id: "integration-widgets",
  title: tr("title"),
  icon: mdiCogOutline,
  memberAccess: true,
  settings: [
    {
      id: "integration-widgets",
      title: tr("title"),
      icon: mdiCogOutline,
      component: Settings,
      administratorOnly: true,
    },
  ],
  widgets: {
    "integration-widgets:proxmox": {
      title: tr("proxmox"),
      width: 2,
      height: 2,
      module: tr("title"),
      bare: true,
      component: ({
        config,
        editing,
      }: {
        kind: string;
        config?: Record<string, string>;
        editing?: boolean;
      }) => <Card provider="proxmox" config={config} editing={editing} />,
      configure: ({
        value,
        onChange,
      }: {
        value: Record<string, string>;
        onChange: (value: Record<string, string>) => void;
      }) => <Configure provider="proxmox" value={value} onChange={onChange} />,
    },
    "integration-widgets:synology": {
      title: tr("synology"),
      width: 2,
      height: 2,
      module: tr("title"),
      bare: true,
      component: ({
        config,
        editing,
      }: {
        kind: string;
        config?: Record<string, string>;
        editing?: boolean;
      }) => <Card provider="synology" config={config} editing={editing} />,
      configure: ({
        value,
        onChange,
      }: {
        value: Record<string, string>;
        onChange: (value: Record<string, string>) => void;
      }) => <Configure provider="synology" value={value} onChange={onChange} />,
    },
    "integration-widgets:home-assistant": {
      title: tr("homeAssistant"),
      width: 2,
      height: 2,
      module: tr("title"),
      bare: true,
      component: ({
        config,
        editing,
      }: {
        kind: string;
        config?: Record<string, string>;
        editing?: boolean;
      }) => (
        <Card provider="home-assistant" config={config} editing={editing} />
      ),
      configure: ({
        value,
        onChange,
      }: {
        value: Record<string, string>;
        onChange: (value: Record<string, string>) => void;
      }) => (
        <Configure
          provider="home-assistant"
          value={value}
          onChange={onChange}
        />
      ),
    },
  },
} as unknown as Parameters<typeof registerModule>[0]);

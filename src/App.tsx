import { useEffect, useMemo, useState } from "react";
import "./styles.css";

const project = {
  sourceNo: 1,
  id: "hxyfront-62001",
  port: 62001,
  title: "船舶轮机值班记录",
  domain: "船舶轮机",
  prompt:
    "我想做一个面向船舶轮机值班的前端记录系统，轮机员可以记录主机转速、滑油压力、冷却水温、燃油消耗、舱底水状态和异常巡检项。页面需要有值班班次切换、机舱参数看板、异常记录时间线、交接班摘要和按设备筛选的历史记录。数据先保存在浏览器本地，后续方便扩展成船队统一管理。",
  palette: ["#0f766e", "#2563eb", "#f97316"],
  metrics: ["主机转速", "滑油压力", "冷却水温", "燃油消耗"],
  filters: ["主机", "发电机", "泵组", "舱底水"],
};

const SHIFTS = ["00-04班", "04-08班", "08-12班", "12-16班", "16-20班", "20-24班"];
const METRICS = project.metrics;
const METRIC_OPTIONS = [...METRICS, "舱底水状态", "异常巡检"];
const STATUS_OPTIONS = ["正常", "已安排复查", "已处理", "待跟进"];
const STORAGE_KEY = "hxyfront-62001-watch-state-v1";

// ---------- 数据模型 ----------

interface Device {
  id: string;
  name: string;
  category: string;
  /** 校准到期日（YYYY-MM-DD），null 表示未登记校准 */
  calibrationDue: string | null;
  /** 豁免原因，按班次序号存档，交班后自动失效 */
  exemptions: Record<string, string>;
}

interface Reading {
  id: string;
  shift: string;
  deviceId: string;
  deviceName: string;
  metric: string;
  value: string;
  anomaly: string;
  status: string;
  note: string;
  createdAt: string;
}

interface HandoverFrozenItem {
  deviceName: string;
  cause: string;
  exemption: string;
}

interface Handover {
  id: string;
  fromShift: string;
  toShift: string;
  completedAt: string;
  frozen: HandoverFrozenItem[];
  note: string;
}

interface WatchState {
  devices: Device[];
  readings: Reading[];
  handovers: Handover[];
  shiftSeq: number;
  filter: string;
}

// ---------- 工具 ----------

function todayStr(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function nowStr(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${todayStr()} ${hh}:${mi}`;
}

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 返回冻结原因；未冻结返回 null */
function freezeCause(device: Device, today: string): string | null {
  if (!device.calibrationDue) return "未登记校准到期日";
  if (device.calibrationDue < today) return `校准已到期（${device.calibrationDue}）`;
  return null;
}

function initialState(): WatchState {
  return {
    shiftSeq: 4,
    filter: "全部",
    devices: [
      { id: "dev-main", name: "主机", category: "主机", calibrationDue: "2026-12-31", exemptions: {} },
      { id: "dev-gen2", name: "发电机#2", category: "发电机", calibrationDue: "2026-08-31", exemptions: {} },
      { id: "dev-pump", name: "泵组A", category: "泵组", calibrationDue: null, exemptions: {} },
      { id: "dev-bilge", name: "舱底水", category: "舱底水", calibrationDue: "2026-10-15", exemptions: {} },
    ],
    readings: [
      {
        id: "seed-5",
        shift: "16-20班",
        deviceId: "dev-bilge",
        deviceName: "舱底水",
        metric: "舱底水状态",
        value: "液位接近警戒线",
        anomaly: "液位接近警戒线",
        status: "已记录交班",
        note: "下一班继续观察液位变化",
        createdAt: "2026-09-19 17:40",
      },
      {
        id: "seed-4",
        shift: "12-16班",
        deviceId: "dev-gen2",
        deviceName: "发电机#2",
        metric: "冷却水温",
        value: "84 ℃",
        anomaly: "冷却水温偏高",
        status: "已安排复查",
        note: "已通知电机员检查冷却器",
        createdAt: "2026-09-19 14:10",
      },
      {
        id: "seed-3",
        shift: "08-12班",
        deviceId: "dev-main",
        deviceName: "主机",
        metric: "燃油消耗",
        value: "32 L/h",
        anomaly: "正常巡检",
        status: "正常",
        note: "",
        createdAt: "2026-09-19 10:05",
      },
      {
        id: "seed-2",
        shift: "08-12班",
        deviceId: "dev-main",
        deviceName: "主机",
        metric: "滑油压力",
        value: "0.42 MPa",
        anomaly: "正常巡检",
        status: "正常",
        note: "",
        createdAt: "2026-09-19 09:30",
      },
      {
        id: "seed-1",
        shift: "08-12班",
        deviceId: "dev-main",
        deviceName: "主机",
        metric: "主机转速",
        value: "86 rpm",
        anomaly: "正常巡检",
        status: "正常",
        note: "",
        createdAt: "2026-09-19 09:00",
      },
    ],
    handovers: [
      {
        id: "seed-h1",
        fromShift: "12-16班",
        toShift: "16-20班",
        completedAt: "2026-09-19 16:05",
        frozen: [
          {
            deviceName: "发电机#2",
            cause: "校准已到期（2026-08-31）",
            exemption: "备件待船供，已申请岸基校准，本班以手动巡检替代",
          },
        ],
        note: "冷却水温偏高已复查，继续观察",
      },
    ],
  };
}

function loadState(): WatchState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw) as WatchState;
    if (!Array.isArray(parsed.devices) || !Array.isArray(parsed.readings)) {
      return initialState();
    }
    return {
      ...initialState(),
      ...parsed,
      handovers: Array.isArray(parsed.handovers) ? parsed.handovers : [],
    };
  } catch {
    return initialState();
  }
}

// ---------- 组件 ----------

function App() {
  const today = useMemo(todayStr, []);
  const [state, setState] = useState<WatchState>(loadState);
  const { devices, readings, handovers, shiftSeq, filter } = state;

  const shift = SHIFTS[shiftSeq % SHIFTS.length];
  const shiftId = `seq-${shiftSeq}`;
  const deviceById = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);

  // 与浏览器存储同步：任何状态变化都写回 localStorage，刷新后保留
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // 新增记录表单
  const [form, setForm] = useState({
    deviceId: "dev-main",
    metric: METRIC_OPTIONS[0],
    value: "",
    anomaly: "",
    status: STATUS_OPTIONS[0],
    note: "",
  });
  const [saveMsg, setSaveMsg] = useState<{ type: "error" | "ok"; text: string } | null>(null);

  // 校准登记 / 续期
  const [renewDates, setRenewDates] = useState<Record<string, string>>({});
  const [calMsg, setCalMsg] = useState<{ type: "error" | "ok"; text: string } | null>(null);

  // 交接班
  const [handoverNote, setHandoverNote] = useState("");

  // 冻结闭环派生状态
  const frozenList = devices
    .map((device) => ({ device, cause: freezeCause(device, today) }))
    .filter((x): x is { device: Device; cause: string } => x.cause !== null);
  const blocking = frozenList.filter((x) => !(x.device.exemptions[shiftId] ?? "").trim());
  const canHandover = blocking.length === 0;

  // 参数看板：每个参数取最新一条读数（readings 新的在前）
  const dashboard = METRICS.map((metric) => {
    const latest = readings.find((r) => r.metric === metric);
    return {
      metric,
      value: latest ? latest.value : "—",
      deviceName: latest?.deviceName ?? "",
      shift: latest?.shift ?? "",
    };
  });

  // 设备筛选（与存储同步）
  const filteredReadings =
    filter === "全部"
      ? readings
      : readings.filter((r) => (deviceById.get(r.deviceId)?.category ?? "未分类") === filter);

  // ---------- 行为 ----------

  /** 保存读数：被冻结设备整条拒绝，原记录与参数看板保持不变 */
  function saveReading() {
    const device = deviceById.get(form.deviceId);
    if (!device) {
      setSaveMsg({ type: "error", text: "请选择设备" });
      return;
    }
    const cause = freezeCause(device, today);
    if (cause) {
      setSaveMsg({
        type: "error",
        text: `保存被拒绝：设备「${device.name}」${cause}，仪表处于校准冻结状态，整条记录未保存。请先完成校准续期，历史读数与参数看板保持不变。`,
      });
      return;
    }
    if (!form.value.trim()) {
      setSaveMsg({ type: "error", text: "请填写参数读数" });
      return;
    }
    const reading: Reading = {
      id: makeId(),
      shift,
      deviceId: device.id,
      deviceName: device.name,
      metric: form.metric,
      value: form.value.trim(),
      anomaly: form.anomaly.trim() || "正常巡检",
      status: form.status,
      note: form.note.trim(),
      createdAt: nowStr(),
    };
    setState((s) => ({ ...s, readings: [reading, ...s.readings] }));
    setForm((f) => ({ ...f, value: "", anomaly: "", note: "" }));
    setSaveMsg({ type: "ok", text: `已保存：${shift} · ${device.name} · ${form.metric} ${reading.value}` });
  }

  /** 校准登记 / 续期：仅更新到期日解除冻结，历史读数不做任何改写 */
  function renewCalibration(device: Device) {
    const date = (renewDates[device.id] ?? "").trim();
    if (!date) {
      setCalMsg({ type: "error", text: `请先为「${device.name}」选择校准到期日` });
      return;
    }
    if (date < today) {
      setCalMsg({ type: "error", text: `「${device.name}」的校准到期日不能早于今天（${today}）` });
      return;
    }
    const action = device.calibrationDue ? "续期" : "登记";
    setState((s) => ({
      ...s,
      devices: s.devices.map((d) => (d.id === device.id ? { ...d, calibrationDue: date } : d)),
    }));
    setCalMsg({
      type: "ok",
      text: `「${device.name}」校准${action}至 ${date}，冻结已解除；历史读数保持不变。`,
    });
  }

  /** 登记本班豁免原因（仅当前班次有效） */
  function updateExemption(deviceId: string, reason: string) {
    setState((s) => ({
      ...s,
      devices: s.devices.map((d) =>
        d.id === deviceId ? { ...d, exemptions: { ...d.exemptions, [shiftId]: reason } } : d
      ),
    }));
  }

  /** 完成交接班：存在未续期且未填写豁免原因的被冻结设备时不得完成 */
  function completeHandover() {
    if (!canHandover) return;
    const record: Handover = {
      id: makeId(),
      fromShift: shift,
      toShift: SHIFTS[(shiftSeq + 1) % SHIFTS.length],
      completedAt: nowStr(),
      frozen: frozenList.map((x) => ({
        deviceName: x.device.name,
        cause: x.cause,
        exemption: (x.device.exemptions[shiftId] ?? "").trim(),
      })),
      note: handoverNote.trim(),
    };
    setState((s) => ({ ...s, handovers: [record, ...s.handovers], shiftSeq: s.shiftSeq + 1 }));
    setHandoverNote("");
  }

  function exportSummary() {
    const lines = [
      `${project.title} · 导出时间 ${nowStr()}`,
      `当前班次：${shift} · 设备筛选：${filter}`,
      "",
      "【参数看板】",
      ...dashboard.map((d) =>
        d.deviceName ? `${d.metric}：${d.value}（${d.deviceName} · ${d.shift}）` : `${d.metric}：—（暂无读数）`
      ),
      "",
      "【校准冻结】",
      ...(frozenList.length
        ? frozenList.map((x) => `${x.device.name}：${x.cause}`)
        : ["无被冻结设备"]),
      "",
      `【历史记录 · ${filter}】`,
      ...filteredReadings.map(
        (r, i) =>
          `${i + 1}. [${r.shift}] ${r.deviceName} · ${r.metric} ${r.value} · ${r.anomaly} · ${r.status}` +
          (r.note ? ` · 备注：${r.note}` : "")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `轮机值班摘要-${today}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- 视图 ----------

  return (
    <main className="app">
      <section className="hero">
        <p>
          {project.id} · 源提示词{project.sourceNo} · Port {project.port}
        </p>
        <h1>{project.title}</h1>
        <span>{project.prompt}</span>
      </section>

      <section className="metrics">
        {dashboard.map((d) => (
          <article key={d.metric}>
            <small>{d.metric}</small>
            <strong>{d.value}</strong>
            <em>{d.deviceName ? `${d.deviceName} · ${d.shift}` : "暂无读数"}</em>
          </article>
        ))}
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>{project.domain}筛选</h2>
          <div className="chips">
            {["全部", ...project.filters].map((item) => (
              <button
                key={item}
                className={filter === item ? "chip-active" : ""}
                onClick={() => setState((s) => ({ ...s, filter: item }))}
              >
                {item}
              </button>
            ))}
          </div>

          <h2 className="aside-sub">校准状态</h2>
          <ul className="device-status">
            {devices.map((d) => {
              const cause = freezeCause(d, today);
              return (
                <li key={d.id}>
                  <span>{d.name}</span>
                  {cause ? (
                    <b className="badge frozen">已冻结</b>
                  ) : (
                    <b className="badge ok">有效至 {d.calibrationDue}</b>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="panel form-panel">
          <div className="heading">
            <div>
              <p>专业字段</p>
              <h2>新增记录 · 当前{shift}</h2>
            </div>
            <button className="primary" onClick={saveReading}>
              保存记录
            </button>
          </div>

          {saveMsg && <div className={`alert ${saveMsg.type}`}>{saveMsg.text}</div>}

          <div className="field-grid">
            <label>
              <span>值班班次</span>
              <input value={shift} readOnly />
            </label>
            <label>
              <span>设备名称</span>
              <select
                value={form.deviceId}
                onChange={(e) => setForm((f) => ({ ...f, deviceId: e.target.value }))}
              >
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {freezeCause(d, today) ? "（校准冻结）" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>参数项目</span>
              <select
                value={form.metric}
                onChange={(e) => setForm((f) => ({ ...f, metric: e.target.value }))}
              >
                {METRIC_OPTIONS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label>
              <span>参数读数</span>
              <input
                placeholder="如 86 rpm / 0.42 MPa"
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              />
            </label>
            <label>
              <span>异常描述</span>
              <input
                placeholder="无异常可留空，默认正常巡检"
                value={form.anomaly}
                onChange={(e) => setForm((f) => ({ ...f, anomaly: e.target.value }))}
              />
            </label>
            <label>
              <span>处理状态</span>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="field-wide">
              <span>交接备注</span>
              <input
                placeholder="填写交接备注"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </label>
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>仪表校准</p>
            <h2>校准登记与冻结闭环</h2>
          </div>
          <span className="hint">到期或未登记校准的设备将被冻结，续期后自动解除；历史读数不做改写</span>
        </div>

        {calMsg && <div className={`alert ${calMsg.type}`}>{calMsg.text}</div>}

        <div className="cal-list">
          {devices.map((d) => {
            const cause = freezeCause(d, today);
            return (
              <article key={d.id} className={cause ? "cal-row frozen-row" : "cal-row"}>
                <div className="cal-info">
                  <h3>
                    {d.name}
                    <small>{d.category}</small>
                  </h3>
                  <p>
                    校准到期日：{d.calibrationDue ?? "未登记"}
                    {cause ? ` · ${cause}` : " · 校准有效"}
                  </p>
                </div>
                {cause ? <b className="badge frozen">已冻结 · 读数保存将被拒绝</b> : <b className="badge ok">正常</b>}
                <div className="cal-actions">
                  <input
                    type="date"
                    min={today}
                    value={renewDates[d.id] ?? ""}
                    onChange={(e) =>
                      setRenewDates((m) => ({ ...m, [d.id]: e.target.value }))
                    }
                  />
                  <button className="primary" onClick={() => renewCalibration(d)}>
                    {d.calibrationDue ? "校准续期" : "登记校准"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>交接班</p>
            <h2>
              {shift} → {SHIFTS[(shiftSeq + 1) % SHIFTS.length]}
            </h2>
          </div>
          <button className="primary" disabled={!canHandover} onClick={completeHandover}>
            完成交接班
          </button>
        </div>

        {frozenList.length > 0 ? (
          <>
            {!canHandover && (
              <div className="alert error">
                本班仍有未续期且未填写豁免原因的被冻结设备，不得完成交接班：
                {blocking.map((x) => x.device.name).join("、")}
              </div>
            )}
            <div className="frozen-list">
              {frozenList.map(({ device, cause }) => {
                const exemption = device.exemptions[shiftId] ?? "";
                return (
                  <article key={device.id} className="frozen-item">
                    <div className="cal-info">
                      <h3>
                        {device.name}
                        <small>{cause}</small>
                      </h3>
                      <p>{exemption.trim() ? "已填写本班豁免原因，可交接" : "请续期校准，或填写本班豁免原因"}</p>
                    </div>
                    {exemption.trim() ? (
                      <b className="badge ok">豁免已登记</b>
                    ) : (
                      <b className="badge frozen">待处理</b>
                    )}
                    <input
                      placeholder="豁免原因（仅本班有效），如：备件待船供，以手动巡检替代"
                      value={exemption}
                      onChange={(e) => updateExemption(device.id, e.target.value)}
                    />
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className="alert ok">本班无被冻结设备，可直接完成交接班。</div>
        )}

        <label className="handover-note">
          <span>交接备注</span>
          <input
            placeholder="填写本班交接备注"
            value={handoverNote}
            onChange={(e) => setHandoverNote(e.target.value)}
          />
        </label>

        {handovers.length > 0 && (
          <div className="handover-history">
            <h3>交接摘要</h3>
            {handovers.map((h) => (
              <article key={h.id}>
                <p className="handover-head">
                  <b>
                    {h.fromShift} → {h.toShift}
                  </b>
                  <span>{h.completedAt}</span>
                </p>
                {h.frozen.length > 0 && (
                  <ul>
                    {h.frozen.map((f) => (
                      <li key={f.deviceName}>
                        设备「{f.deviceName}」 · {f.cause} · 豁免原因：{f.exemption}
                      </li>
                    ))}
                  </ul>
                )}
                {h.note && <p className="handover-memo">备注：{h.note}</p>}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>历史记录</p>
            <h2>近期工作台 · {filter}</h2>
          </div>
          <button onClick={exportSummary}>导出摘要</button>
        </div>
        <div className="records">
          {filteredReadings.length === 0 && <p className="empty">当前筛选下暂无记录</p>}
          {filteredReadings.map((r, index) => {
            const device = deviceById.get(r.deviceId);
            const cause = device ? freezeCause(device, today) : null;
            return (
              <article key={r.id}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <div>
                  <h3>
                    [{r.shift}] {r.deviceName} · {r.metric} {r.value}
                    {cause && <em className="badge frozen">当前校准冻结</em>}
                  </h3>
                  <p>
                    {r.anomaly} · {r.status}
                    {r.note ? ` · 备注：${r.note}` : ""} · {r.createdAt}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

export default App;

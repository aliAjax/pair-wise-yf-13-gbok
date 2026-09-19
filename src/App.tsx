import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  ALL_METRICS,
  CATEGORIES,
  FREEZE_LABEL,
  METRICS,
  SHIFT_PRESETS,
  STORAGE_KEY,
  deviceFreezeState,
  daysUntil,
  exemptionFor,
  formatDateTime,
  isFrozen,
  latestByMetric,
  loadState,
  nowLocalISO,
  saveState,
  todayStr,
  uid,
  type FreezeState,
} from "./domain";
import type {
  CalibrationLog,
  Category,
  Device,
  Exemption,
  PersistState,
  Reading,
  Shift,
} from "./types";

type Notice = { kind: "error" | "success" | "info"; text: string } | null;

function suggestShiftName(): string {
  const slot = Math.min(Math.floor(new Date().getHours() / 4), 5);
  return SHIFT_PRESETS[slot];
}

function StatusBadge({ state }: { state: FreezeState }) {
  return <span className={`badge badge-${state}`}>{FREEZE_LABEL[state]}</span>;
}

function App() {
  const [state, setState] = useState<PersistState>(() => loadState());
  const [shiftNotice, setShiftNotice] = useState<Notice>(null);
  const [readingNotice, setReadingNotice] = useState<Notice>(null);
  const [deviceNotice, setDeviceNotice] = useState<Notice>(null);

  /* 班次 */
  const [newShiftName, setNewShiftName] = useState(suggestShiftName());
  const [handoverNote, setHandoverNote] = useState("");

  /* 读数表单 */
  const [formDeviceId, setFormDeviceId] = useState("");
  const [formMetric, setFormMetric] = useState<string>(ALL_METRICS[0]);
  const [formValue, setFormValue] = useState("");
  const [formNote, setFormNote] = useState("");
  const [formAbnormal, setFormAbnormal] = useState(false);
  const [formAbnormalDesc, setFormAbnormalDesc] = useState("");
  const [formHandling, setFormHandling] = useState("待处理");

  /* 设备登记 */
  const [newDeviceName, setNewDeviceName] = useState("");
  const [newDeviceCategory, setNewDeviceCategory] = useState<Category>("主机");

  /* 豁免原因草稿：deviceId -> reason */
  const [exemptionDrafts, setExemptionDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    setHandoverNote(state.shifts.find((s) => s.id === state.activeShiftId)?.handoverNote ?? "");
  }, [state.activeShiftId, state.shifts]);

  const patch = (p: Partial<PersistState>) => setState((prev) => ({ ...prev, ...p }));

  const deviceMap = useMemo(() => {
    const m = new Map<string, Device>();
    state.devices.forEach((d) => m.set(d.id, d));
    return m;
  }, [state.devices]);

  const activeShift = state.shifts.find((s) => s.id === state.activeShiftId) ?? null;
  const viewShift = state.shifts.find((s) => s.id === state.viewShiftId) ?? null;

  const deviceRows = useMemo(
    () =>
      state.devices.map((device) => ({
        device,
        freeze: deviceFreezeState(device),
        exemption: activeShift ? exemptionFor(state.exemptions, activeShift.id, device.id) : undefined,
      })),
    [state.devices, state.exemptions, activeShift]
  );

  const frozenActive = deviceRows.filter((r) => isFrozen(r.freeze));
  const blockedForHandover = frozenActive.filter((r) => !r.exemption || !r.exemption.reason.trim());

  /* 交接摘要查看历史班次时，按该班次的豁免记录还原“当时被冻结”的设备清单 */
  const handoverRows = useMemo(() => {
    const target = activeShift ?? viewShift;
    if (!target) return [] as { device: Device; freeze: FreezeState; exemption?: Exemption }[];
    return state.devices
      .map((device) => ({
        device,
        freeze: deviceFreezeState(device),
        exemption: exemptionFor(state.exemptions, target.id, device.id),
      }))
      // 进行中的班次列出当前所有冻结设备；已封存班次只列出当时登记过豁免的设备
      .filter((r) => (target.id === activeShift?.id ? isFrozen(r.freeze) : Boolean(r.exemption)));
  }, [state.devices, state.exemptions, activeShift, viewShift]);

  const handoverTarget = activeShift ?? viewShift;

  const filteredDevices =
    state.filter === "全部" ? state.devices : state.devices.filter((d) => d.category === state.filter);
  const filteredDeviceIds = new Set(filteredDevices.map((d) => d.id));

  const scopedReadings = useMemo(() => {
    const list = state.readings
      .filter((r) => r.shiftId === state.viewShiftId && filteredDeviceIds.has(r.deviceId))
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return list;
  }, [state.readings, state.viewShiftId, filteredDeviceIds]);

  const dashboard = useMemo(
    () =>
      latestByMetric(
        METRICS,
        state.readings.filter((r) => filteredDeviceIds.has(r.deviceId)),
        state.readings.filter(
          (r) => r.shiftId === state.viewShiftId && filteredDeviceIds.has(r.deviceId)
        )
      ),
    [state.readings, state.viewShiftId, filteredDeviceIds]
  );

  const abnormalTimeline = scopedReadings.filter((r) => r.abnormal);
  const logs = [...state.calibrationLogs].sort((a, b) => (a.at < b.at ? 1 : -1));

  /* ---------------- 班次操作 ---------------- */

  const startShift = () => {
    if (activeShift) {
      setShiftNotice({ kind: "error", text: "本班尚未完成交接班，不能同时开始新班次。" });
      return;
    }
    const name = newShiftName.trim();
    if (!name) {
      setShiftNotice({ kind: "error", text: "请填写或选择值班班次名称。" });
      return;
    }
    const shift: Shift = {
      id: uid("sh"),
      name,
      startedAt: nowLocalISO(),
      endedAt: null,
      handoverNote: "",
    };
    setState((prev) => ({
      ...prev,
      shifts: [...prev.shifts, shift],
      activeShiftId: shift.id,
      viewShiftId: shift.id,
    }));
    setHandoverNote("");
    setShiftNotice({ kind: "success", text: `本班次 ${name} 已开始。` });
  };

  const completeHandover = () => {
    if (!activeShift) return;
    if (blockedForHandover.length > 0) {
      setShiftNotice({
        kind: "error",
        text: `仍有 ${blockedForHandover.length} 台被冻结设备未续期或未填写豁免原因，不能完成交接班。`,
      });
      return;
    }
    setState((prev) => ({
      ...prev,
      shifts: prev.shifts.map((s) =>
        s.id === activeShift.id ? { ...s, endedAt: nowLocalISO(), handoverNote } : s
      ),
      activeShiftId: null,
      viewShiftId: activeShift.id,
    }));
    setShiftNotice({
      kind: "success",
      text: `班次 ${activeShift.name} 已完成交接班并封存，历史读数不可改写。`,
    });
  };

  /* ---------------- 仪表校准 ---------------- */

  const registerDevice = () => {
    const name = newDeviceName.trim();
    if (!name) {
      setDeviceNotice({ kind: "error", text: "设备名称不能为空。" });
      return;
    }
    if (state.devices.some((d) => d.name === name)) {
      setDeviceNotice({ kind: "error", text: `设备「${name}」已登记，请勿重复添加。` });
      return;
    }
    const device: Device = {
      id: uid("dev"),
      name,
      category: newDeviceCategory,
      calibrationDue: "",
      renewedAt: null,
    };
    setState((prev) => ({ ...prev, devices: [...prev.devices, device] }));
    setNewDeviceName("");
    setFormDeviceId(device.id);
    setDeviceNotice({
      kind: "info",
      text: `设备「${name}」已登记，但尚未登记仪表校准到期日，保存读数将被冻结拒绝。`,
    });
  };

  const renewCalibration = (device: Device, due: string) => {
    if (!due) {
      setDeviceNotice({ kind: "error", text: `请为「${device.name}」选择校准到期日。` });
      return;
    }
    const left = daysUntil(due);
    if (left < 0) {
      setDeviceNotice({
        kind: "error",
        text: `「${device.name}」校准到期日 ${due} 已过去，续期后仍为冻结状态，请重新选择。`,
      });
      return;
    }
    const at = nowLocalISO();
    const log: CalibrationLog = {
      id: uid("log"),
      deviceId: device.id,
      previousDue: device.calibrationDue,
      newDue: due,
      at,
    };
    setState((prev) => ({
      ...prev,
      devices: prev.devices.map((d) =>
        d.id === device.id ? { ...d, calibrationDue: due, renewedAt: at } : d
      ),
      calibrationLogs: [...prev.calibrationLogs, log],
    }));
    setDeviceNotice({
      kind: "success",
      text: `「${device.name}」校准已续期至 ${due}，设备冻结已解除；既有历史读数保持不变。`,
    });
  };

  /* ---------------- 读数保存（冻结闭环核心） ---------------- */

  const saveReading = () => {
    if (!activeShift) {
      setReadingNotice({ kind: "error", text: "当前没有进行中的班次，请先开始本班再记录读数。" });
      return;
    }
    const device = deviceMap.get(formDeviceId);
    if (!device) {
      setReadingNotice({ kind: "error", text: "请选择设备后再保存读数。" });
      return;
    }
    const freeze = deviceFreezeState(device);
    if (isFrozen(freeze)) {
      /* 整条拒绝：不写入任何读数，原记录与看板保持不变 */
      setReadingNotice({
        kind: "error",
        text:
          freeze === "unregistered"
            ? `保存被拒绝：设备「${device.name}」未登记仪表校准到期日，已冻结。整条读数未保存，请先完成校准登记/续期。`
            : `保存被拒绝：设备「${device.name}」仪表校准已于 ${device.calibrationDue} 到期，已冻结。整条读数未保存，请先完成校准续期。`,
      });
      return;
    }
    const value = formValue.trim();
    if (!value) {
      setReadingNotice({ kind: "error", text: "参数读数不能为空，整条记录未保存。" });
      return;
    }
    if (formAbnormal && !formAbnormalDesc.trim()) {
      setReadingNotice({ kind: "error", text: "勾选异常巡检后必须填写异常描述。" });
      return;
    }
    const reading: Reading = {
      id: uid("rd"),
      shiftId: activeShift.id,
      deviceId: device.id,
      metric: formMetric,
      value,
      note: formNote.trim(),
      abnormal: formAbnormal,
      abnormalDesc: formAbnormalDesc.trim(),
      handlingStatus: formAbnormal ? formHandling : "正常",
      at: nowLocalISO(),
    };
    setState((prev) => ({ ...prev, readings: [...prev.readings, reading] }));
    setFormValue("");
    setFormNote("");
    setFormAbnormal(false);
    setFormAbnormalDesc("");
    setFormHandling("待处理");
    setReadingNotice({
      kind: "success",
      text: `已保存「${device.name} · ${formMetric}」读数至班次 ${activeShift.name}。`,
    });
  };

  /* ---------------- 豁免原因 ---------------- */

  const saveExemption = (device: Device) => {
    if (!activeShift) return;
    const reason = (exemptionDrafts[device.id] ?? "").trim();
    if (!reason) {
      setDeviceNotice({ kind: "error", text: `请先填写「${device.name}」的冻结豁免原因。` });
      return;
    }
    setState((prev) => {
      const others = prev.exemptions.filter(
        (e) => !(e.shiftId === activeShift.id && e.deviceId === device.id)
      );
      const exemption: Exemption = {
        shiftId: activeShift.id,
        deviceId: device.id,
        reason,
        at: nowLocalISO(),
      };
      return { ...prev, exemptions: [...others, exemption] };
    });
    setDeviceNotice({
      kind: "success",
      text: `已登记「${device.name}」本班豁免原因；该设备仍禁止保存读数，仅用于完成交接班说明。`,
    });
  };

  /* ---------------- 渲染 ---------------- */

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62001 · 船舶轮机值班 · 仪表校准冻结闭环</p>
        <h1>船舶轮机值班记录</h1>
        <span>
          按设备登记仪表校准到期日：校准到期或未登记校准的设备保存读数时整条拒绝，原记录与参数看板不变；校准续期解除冻结，历史读数只可追加、不得改写；本班存在未续期或未填写豁免原因的冻结设备时不得交接班。筛选、看板与班次数据均保存在浏览器本地，刷新后保留。
        </span>
      </section>

      {/* 班次管理 */}
      <section className="panel shift-bar">
        <div className="shift-main">
          <h2>值班班次</h2>
          {activeShift ? (
            <p className="shift-active">
              当前本班：<strong>{activeShift.name}</strong>
              <span className="dot dot-live" /> 进行中 · 开始 {formatDateTime(activeShift.startedAt)}
            </p>
          ) : (
            <p className="shift-active muted">本班次已交接封存（或尚未开始），历史记录只读。</p>
          )}
        </div>
        <div className="shift-controls">
          <label className="inline-field">
            <span>查看班次</span>
            <select
              value={state.viewShiftId ?? ""}
              onChange={(e) => patch({ viewShiftId: e.target.value || null })}
            >
              {[...state.shifts].reverse().map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.id === state.activeShiftId ? "（本班）" : s.endedAt ? "（已交接）" : ""}
                </option>
              ))}
            </select>
          </label>
          {!activeShift && (
            <label className="inline-field">
              <span>开始新班次</span>
              <select value={newShiftName} onChange={(e) => setNewShiftName(e.target.value)}>
                {SHIFT_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!activeShift && (
            <button className="primary" onClick={startShift}>
              开始本班
            </button>
          )}
        </div>
        {shiftNotice && <p className={`notice notice-${shiftNotice.kind}`}>{shiftNotice.text}</p>}
      </section>

      {/* 设备筛选 + 参数看板 */}
      <aside className="panel filter-panel">
        <h2>设备筛选</h2>
        <div className="chips">
          {(["全部", ...CATEGORIES] as const).map((item) => (
            <button
              key={item}
              className={state.filter === item ? "chip-on" : ""}
              onClick={() => patch({ filter: item })}
            >
              {item}
            </button>
          ))}
        </div>
        <p className="hint">筛选条件同步影响参数看板、异常时间线与历史记录，并保存在浏览器本地。</p>
      </aside>

      <section className="metrics">
        {dashboard.map((card) => (
          <article key={card.metric}>
            <small>{card.metric}</small>
            <strong className={card.at ? "" : "metric-empty"}>{card.value}</strong>
            <p className="metric-meta">
              {card.at ? `更新于 ${formatDateTime(card.at)}` : `当前筛选下暂无读数`}
            </p>
          </article>
        ))}
      </section>

      <section className="workspace">
        {/* 设备校准登记 / 冻结管理 */}
        <aside className="panel device-panel">
          <div className="heading">
            <div>
              <p>仪表校准</p>
              <h2>设备校准冻结管理</h2>
            </div>
          </div>

          <div className="device-register">
            <label>
              <span>新建设备登记（登记后仍需录入校准到期日）</span>
              <div className="inline-row">
                <input
                  placeholder="设备名称，如 发电机#3"
                  value={newDeviceName}
                  onChange={(e) => setNewDeviceName(e.target.value)}
                />
                <select
                  value={newDeviceCategory}
                  onChange={(e) => setNewDeviceCategory(e.target.value as Category)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <button onClick={registerDevice}>登记设备</button>
          </div>

          {deviceNotice && <p className={`notice notice-${deviceNotice.kind}`}>{deviceNotice.text}</p>}

          <div className="device-list">
            {deviceRows.map(({ device, freeze, exemption }) => (
              <article key={device.id} className={`device-card device-${freeze}`}>
                <div className="device-card-head">
                  <div>
                    <h3>
                      {device.name} <small>{device.category}</small>
                    </h3>
                    <StatusBadge state={freeze} />
                  </div>
                  <p className="due-text">
                    {device.calibrationDue ? (
                      <>
                        到期日 {device.calibrationDue}
                        {freeze === "expired" && <> · 已过期 {-daysUntil(device.calibrationDue)} 天</>}
                        {freeze === "expiring" && <> · 剩 {daysUntil(device.calibrationDue)} 天</>}
                        {freeze === "valid" && <> · 余 {daysUntil(device.calibrationDue)} 天</>}
                      </>
                    ) : (
                      "未登记校准到期日"
                    )}
                  </p>
                </div>
                <div className="renew-row" data-device-id={device.id}>
                  <input
                    type="date"
                    min={todayStr()}
                    defaultValue={device.calibrationDue || todayStr()}
                    key={`${device.id}-${device.calibrationDue}`}
                    aria-label={`${device.name}校准到期日`}
                  />
                  <button
                    onClick={(e) => {
                      const row = e.currentTarget.closest(".renew-row");
                      const input = row?.querySelector("input[type='date']") as HTMLInputElement | null;
                      if (input) renewCalibration(device, input.value);
                    }}
                  >
                    校准续期
                  </button>
                </div>
                {isFrozen(freeze) && activeShift && (
                  <div className="exemption-box">
                    <p className="hint">
                      冻结设备：读数保存一律拒绝。如需交接班，请登记本班豁免原因：
                    </p>
                    {exemption ? (
                      <div className="exemption-record">
                        <p>
                          <span className="tag tag-ok">已豁免（本班）</span>
                          {exemption.reason}
                        </p>
                        <small>登记于 {formatDateTime(exemption.at)}</small>
                      </div>
                    ) : null}
                    <textarea
                      rows={2}
                      placeholder="填写豁免原因，如：已报机务申领校准件，接班后继续跟踪"
                      value={exemptionDrafts[device.id] ?? exemption?.reason ?? ""}
                      onChange={(e) =>
                        setExemptionDrafts((prev) => ({ ...prev, [device.id]: e.target.value }))
                      }
                    />
                    <button onClick={() => saveExemption(device)}>
                      {exemption ? "更新豁免原因" : "保存豁免原因"}
                    </button>
                  </div>
                )}
                {isFrozen(freeze) && !activeShift && (
                  <p className="hint">本班已交接，豁免原因只读展示于交接摘要。</p>
                )}
              </article>
            ))}
          </div>
        </aside>

        {/* 读数录入 */}
        <section className="panel form-panel">
          <div className="heading">
            <div>
              <p>参数读数</p>
              <h2>新增值班记录</h2>
            </div>
            <button className="primary" onClick={saveReading} disabled={!activeShift}>
              保存读数
            </button>
          </div>

          {viewShift && activeShift && viewShift.id !== activeShift.id && (
            <p className="notice notice-info">
              正在查看历史班次 {viewShift.name}，新读数仍将保存至本班 {activeShift.name}。
            </p>
          )}
          {readingNotice && (
            <p className={`notice notice-${readingNotice.kind}`}>{readingNotice.text}</p>
          )}
          {!activeShift && (
            <p className="notice notice-error">
              没有进行中的班次，读数录入已锁定；历史读数只读、不得改写。
            </p>
          )}

          <div className="field-grid">
            <label>
              <span>设备名称</span>
              <select
                value={formDeviceId}
                onChange={(e) => setFormDeviceId(e.target.value)}
                disabled={!activeShift}
              >
                <option value="">请选择设备</option>
                {deviceRows.map(({ device, freeze }) => (
                  <option key={device.id} value={device.id}>
                    {device.name}（{device.category}）
                    {isFrozen(freeze)
                      ? freeze === "unregistered"
                        ? " · 未登记校准-冻结"
                        : " · 校准到期-冻结"
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>参数项</span>
              <select
                value={formMetric}
                onChange={(e) => setFormMetric(e.target.value)}
                disabled={!activeShift}
              >
                {ALL_METRICS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>参数读数</span>
              <input
                placeholder="如 82 rpm / 0.42 MPa / 76 ℃"
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                disabled={!activeShift}
              />
            </label>
            <label>
              <span>巡检备注</span>
              <input
                placeholder="工况或补充说明"
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                disabled={!activeShift}
              />
            </label>
            <label className="check-field">
              <span>异常巡检项</span>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={formAbnormal}
                  onChange={(e) => setFormAbnormal(e.target.checked)}
                  disabled={!activeShift}
                />
                本班该参数存在异常
              </label>
            </label>
            {formAbnormal && (
              <>
                <label>
                  <span>异常描述</span>
                  <input
                    placeholder="描述异常现象"
                    value={formAbnormalDesc}
                    onChange={(e) => setFormAbnormalDesc(e.target.value)}
                    disabled={!activeShift}
                  />
                </label>
                <label>
                  <span>处理状态</span>
                  <select
                    value={formHandling}
                    onChange={(e) => setFormHandling(e.target.value)}
                    disabled={!activeShift}
                  >
                    <option>待处理</option>
                    <option>处理中</option>
                    <option>已处理</option>
                    <option>已安排复查</option>
                    <option>已记录交班</option>
                  </select>
                </label>
              </>
            )}
          </div>
        </section>
      </section>

      {/* 异常记录时间线 */}
      <section className="panel">
        <div className="heading">
          <div>
            <p>异常巡检</p>
            <h2>异常记录时间线{viewShift ? ` · ${viewShift.name}` : ""}</h2>
          </div>
        </div>
        {abnormalTimeline.length === 0 ? (
          <p className="hint">当前班次与筛选条件下没有异常记录。</p>
        ) : (
          <div className="timeline">
            {abnormalTimeline.map((r) => (
              <article key={r.id}>
                <time>{formatDateTime(r.at)}</time>
                <div>
                  <h3>
                    {deviceMap.get(r.deviceId)?.name ?? "未知设备"} · {r.metric}
                  </h3>
                  <p>{r.abnormalDesc}</p>
                  <p className="hint">
                    读数 {r.value} · 处理状态：{r.handlingStatus}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 历史记录（只读） */}
      <section className="panel">
        <div className="heading">
          <div>
            <p>历史记录（只可追加，不得改写）</p>
            <h2>近期工作台{viewShift ? ` · ${viewShift.name}` : ""}</h2>
          </div>
          <span className="readonly-tag">只读</span>
        </div>
        {scopedReadings.length === 0 ? (
          <p className="hint">当前班次与筛选条件下暂无读数记录。</p>
        ) : (
          <div className="records">
            {scopedReadings.map((record, index) => {
              const device = deviceMap.get(record.deviceId);
              return (
                <article key={record.id}>
                  <b>{String(scopedReadings.length - index).padStart(2, "0")}</b>
                  <div>
                    <h3>
                      {device?.name ?? "未知设备"} · {record.metric}
                      {record.abnormal && <span className="tag tag-abn">异常</span>}
                    </h3>
                    <p>
                      读数 {record.value}
                      {record.note ? ` · ${record.note}` : ""}
                      {record.abnormal ? ` · ${record.abnormalDesc}（${record.handlingStatus}）` : ""}
                    </p>
                    <small className="hint">记录时间 {formatDateTime(record.at)}</small>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 交接班摘要 */}
      <section className="panel handover-panel">
        <div className="heading">
          <div>
            <p>交接班摘要</p>
            <h2>{activeShift ? `${activeShift.name} · 交接确认` : viewShift ? `${viewShift.name} · 交接记录（已封存）` : "交接记录"}</h2>
          </div>
          {activeShift && (
            <button
              className="danger"
              onClick={completeHandover}
              disabled={blockedForHandover.length > 0}
              title={blockedForHandover.length > 0 ? "存在未续期或未豁免的冻结设备" : "完成交接班"}
            >
              完成交接班
            </button>
          )}
        </div>

        {activeShift || viewShift ? (
          <>
            <div className="handover-stats">
              <span>开始：{formatDateTime(handoverTarget!.startedAt)}</span>
              <span>
                结束：
                {handoverTarget!.endedAt ? formatDateTime(handoverTarget!.endedAt) : "未交接"}
              </span>
              <span>
                读数条数：
                {state.readings.filter((r) => r.shiftId === handoverTarget!.id).length}
              </span>
              <span>
                异常项：
                {
                  state.readings.filter(
                    (r) => r.shiftId === handoverTarget!.id && r.abnormal
                  ).length
                }
              </span>
              <span>
                {activeShift ? `本班冻结设备：${frozenActive.length}` : "当时冻结豁免设备：见下表"}
              </span>
            </div>

            <h3>冻结设备与原因清单</h3>
            {handoverRows.length === 0 ? (
              <p className="hint">
                {activeShift ? "本班没有被冻结的设备，可以正常交接班。" : "本班次交接时没有冻结设备或豁免登记。"}
              </p>
            ) : (
              <table className="freeze-table">
                <thead>
                  <tr>
                    <th>设备</th>
                    <th>冻结原因</th>
                    <th>校准状态</th>
                    <th>{activeShift ? "本班豁免原因" : "交班时豁免原因"}</th>
                  </tr>
                </thead>
                <tbody>
                  {handoverRows.map(({ device, freeze, exemption }) => (
                    <tr key={device.id}>
                      <td>
                        {device.name}
                        <br />
                        <small>{device.category}</small>
                      </td>
                      <td>
                        {freeze === "unregistered"
                          ? "未登记仪表校准到期日，禁止保存读数"
                          : `仪表校准已于 ${device.calibrationDue} 到期，禁止保存读数`}
                      </td>
                      <td>
                        <StatusBadge state={freeze} />
                      </td>
                      <td>
                        {exemption ? (
                          <>
                            {exemption.reason}
                            <br />
                            <small>登记于 {formatDateTime(exemption.at)}</small>
                          </>
                        ) : (
                          <span className="tag tag-miss">缺失：未填写豁免原因</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {activeShift && blockedForHandover.length > 0 && (
              <p className="notice notice-error">
                交接班被阻止：{blockedForHandover
                  .map((r) => `「${r.device.name}」`)
                  .join("、")}
                仍未完成校准续期且未填写本班豁免原因。续期解除冻结或补齐豁免原因后方可交接。
              </p>
            )}

            <label className="handover-note">
              <span>交接备注</span>
              <textarea
                rows={3}
                placeholder="记录运行工况、遗留问题与接班注意事项"
                value={activeShift ? handoverNote : viewShift?.handoverNote ?? ""}
                onChange={(e) => setHandoverNote(e.target.value)}
                disabled={!activeShift}
              />
            </label>
          </>
        ) : (
          <p className="hint">暂无班次记录。</p>
        )}
      </section>

      {/* 校准续期台账 */}
      <section className="panel">
        <div className="heading">
          <div>
            <p>审计台账</p>
            <h2>仪表校准续期记录</h2>
          </div>
        </div>
        {logs.length === 0 ? (
          <p className="hint">暂无续期记录。</p>
        ) : (
          <table className="freeze-table log-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>设备</th>
                <th>续期前到期日</th>
                <th>续期后到期日</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDateTime(log.at)}</td>
                  <td>{deviceMap.get(log.deviceId)?.name ?? "已删除设备"}</td>
                  <td>{log.previousDue || "未登记校准"}</td>
                  <td>{log.newDue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint">本地存储键：{STORAGE_KEY}，设备、读数、班次、豁免与筛选状态刷新后保留。</p>
      </section>
    </main>
  );
}

export default App;

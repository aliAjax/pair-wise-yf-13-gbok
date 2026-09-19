import type {
  CalibrationLog,
  Category,
  Device,
  Exemption,
  PersistState,
  Reading,
  Shift,
} from "./types";

export const CATEGORIES: Category[] = ["主机", "发电机", "泵组", "舱底水"];

export const METRICS = [
  "主机转速",
  "滑油压力",
  "冷却水温",
  "燃油消耗",
] as const;

export const EXTRA_METRICS = ["舱底水液位"];

export const ALL_METRICS = [...METRICS, ...EXTRA_METRICS];

export const SHIFT_PRESETS = ["00-04班", "04-08班", "08-12班", "12-16班", "16-20班", "20-24班"];

export type FreezeState = "valid" | "expiring" | "expired" | "unregistered";

export const FREEZE_LABEL: Record<FreezeState, string> = {
  valid: "校准有效",
  expiring: "校准7日内到期",
  expired: "校准已到期",
  unregistered: "未登记校准",
};

export const STORAGE_KEY = "hxyfront-62001-watch-state-v1";

/* ---------------- 日期与编号工具 ---------------- */

export function todayStr(): string {
  return toDateInputValue(new Date());
}

export function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function nowLocalISO(): string {
  const d = new Date();
  return `${toDateInputValue(d)}T${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}:00`;
}

export function parseDate(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
}

export function daysUntil(dateStr: string): number {
  const today = parseDate(todayStr());
  return Math.round((parseDate(dateStr) - today) / 86400000);
}

export function formatDateTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

export function uid(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

/* ---------------- 校准冻结规则 ---------------- */

export function deviceFreezeState(device: Device): FreezeState {
  if (!device.calibrationDue) return "unregistered";
  const left = daysUntil(device.calibrationDue);
  if (left < 0) return "expired";
  if (left <= 7) return "expiring";
  return "valid";
}

export function isFrozen(state: FreezeState): boolean {
  return state === "expired" || state === "unregistered";
}

/* ---------------- 本地存储 ---------------- */

export function seedState(): PersistState {
  const today = new Date();
  const iso = (h: number, m = 0) =>
    `${toDateInputValue(today)}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  const plus = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return toDateInputValue(d);
  };

  const devices: Device[] = [
    { id: "dev-main", name: "主机", category: "主机", calibrationDue: plus(180), renewedAt: iso(7, 30) },
    { id: "dev-gen1", name: "发电机#1", category: "发电机", calibrationDue: plus(25), renewedAt: iso(7, 35) },
    { id: "dev-gen2", name: "发电机#2", category: "发电机", calibrationDue: plus(-3), renewedAt: iso(7, 40) },
    { id: "dev-pump1", name: "海水冷却泵", category: "泵组", calibrationDue: plus(60), renewedAt: iso(7, 45) },
    { id: "dev-pump2", name: "燃油输送泵", category: "泵组", calibrationDue: "", renewedAt: iso(12, 30) },
    { id: "dev-bilge", name: "舱底水", category: "舱底水", calibrationDue: plus(113), renewedAt: iso(8, 0) },
  ];

  const shifts: Shift[] = [
    {
      id: "sh-0812",
      name: "08-12班",
      startedAt: iso(8, 0),
      endedAt: iso(12, 0),
      handoverNote:
        "主机运行平稳；舱底水液位接近警戒线，已启动舱底泵一次并复查；各项参数已交班。",
    },
    {
      id: "sh-1216",
      name: "12-16班",
      startedAt: iso(12, 0),
      endedAt: null,
      handoverNote: "",
    },
  ];

  const mk = (
    id: string,
    shiftId: string,
    deviceId: string,
    metric: string,
    value: string,
    note: string,
    at: string,
    abnormal = false,
    abnormalDesc = "",
    handlingStatus = "正常"
  ): Reading => ({
    id,
    shiftId,
    deviceId,
    metric,
    value,
    note,
    abnormal,
    abnormalDesc,
    handlingStatus,
    at,
  });

  const readings: Reading[] = [
    mk("rd-seed-1", "sh-0812", "dev-main", "主机转速", "82 rpm", "定速巡航工况", iso(8, 30)),
    mk("rd-seed-2", "sh-0812", "dev-main", "滑油压力", "0.42 MPa", "正常范围", iso(8, 30)),
    mk("rd-seed-3", "sh-0812", "dev-main", "冷却水温", "76 ℃", "", iso(10, 0)),
    mk("rd-seed-4", "sh-0812", "dev-main", "燃油消耗", "1.28 t", "本班累计", iso(11, 50)),
    mk("rd-seed-5", "sh-0812", "dev-bilge", "舱底水液位", "1.8 m（警戒线2.0m）", "接近警戒线，已开泵排放并复查", iso(10, 40), true, "舱底水液位接近警戒线", "已处理并交班"),
    mk("rd-seed-6", "sh-1216", "dev-main", "主机转速", "83 rpm", "", iso(13, 0)),
    mk("rd-seed-7", "sh-1216", "dev-main", "滑油压力", "0.43 MPa", "", iso(13, 0)),
    mk("rd-seed-8", "sh-1216", "dev-pump1", "冷却水温", "74 ℃", "海水冷却泵出口温度", iso(14, 10)),
  ];

  const calibrationLogs: CalibrationLog[] = devices
    .filter((d) => d.renewedAt)
    .map((d) => ({
      id: `log-${d.id}`,
      deviceId: d.id,
      previousDue: "",
      newDue: d.calibrationDue,
      at: d.renewedAt as string,
    }));

  return {
    version: 1,
    devices,
    calibrationLogs,
    readings,
    shifts,
    activeShiftId: "sh-1216",
    viewShiftId: "sh-1216",
    exemptions: [
      {
        deviceId: "dev-gen2",
        shiftId: "sh-0812",
        reason: "发电机#2转速表校准已到期，已报机务申领校准件；本班改用便携转速表比对抄录，待复校后恢复在线记录。",
        at: iso(8, 20),
      },
    ],
    filter: "全部",
  };
}

export function loadState(): PersistState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as Partial<PersistState>;
    const seed = seedState();
    return {
      ...seed,
      ...parsed,
      devices: parsed.devices ?? seed.devices,
      calibrationLogs: parsed.calibrationLogs ?? seed.calibrationLogs,
      readings: parsed.readings ?? seed.readings,
      shifts: parsed.shifts ?? seed.shifts,
      exemptions: parsed.exemptions ?? seed.exemptions,
    };
  } catch {
    return seedState();
  }
}

export function saveState(state: PersistState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* 存储不可用时静默失败，不影响当前会话 */
  }
}

/* ---------------- 看板统计 ---------------- */

export function latestByMetric(
  metrics: readonly string[],
  readings: Reading[],
  scopedReadings: Reading[]
): { metric: string; value: string; at: string | null; total: number }[] {
  return metrics.map((metric) => {
    const list = scopedReadings
      .filter((r) => r.metric === metric)
      .sort((a, b) => (a.at < b.at ? 1 : -1));
    const latest = list[0];
    return {
      metric,
      value: latest?.value ?? "暂无读数",
      at: latest ? latest.at : null,
      total: readings.filter((r) => r.metric === metric).length,
    };
  });
}

export function exemptionFor(
  exemptions: Exemption[],
  shiftId: string,
  deviceId: string
): Exemption | undefined {
  return exemptions.find((e) => e.shiftId === shiftId && e.deviceId === deviceId);
}

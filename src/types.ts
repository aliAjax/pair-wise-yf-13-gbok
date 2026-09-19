export type Category = "主机" | "发电机" | "泵组" | "舱底水";

export interface Device {
  id: string;
  name: string;
  category: Category;
  /** 仪表校准到期日 YYYY-MM-DD；空串表示未登记（冻结） */
  calibrationDue: string;
  /** 最近一次登记/续期时间 */
  renewedAt: string | null;
}

export interface CalibrationLog {
  id: string;
  deviceId: string;
  /** 续期前的到期日，空串表示此前未登记 */
  previousDue: string;
  newDue: string;
  at: string;
}

export interface Reading {
  id: string;
  shiftId: string;
  deviceId: string;
  metric: string;
  value: string;
  note: string;
  abnormal: boolean;
  abnormalDesc: string;
  handlingStatus: string;
  at: string;
}

export interface Shift {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string | null;
  handoverNote: string;
}

/** 冻结设备的交接豁免登记（按“班次 + 设备”维度，历史不可改写） */
export interface Exemption {
  deviceId: string;
  shiftId: string;
  reason: string;
  at: string;
}

export interface PersistState {
  version: number;
  devices: Device[];
  calibrationLogs: CalibrationLog[];
  readings: Reading[];
  shifts: Shift[];
  activeShiftId: string | null;
  viewShiftId: string | null;
  exemptions: Exemption[];
  filter: Category | "全部";
}

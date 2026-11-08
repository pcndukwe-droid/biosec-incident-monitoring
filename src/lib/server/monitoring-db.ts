import { MongoClient, type Db, type Document } from "mongodb";
import type { MonitorFields } from "./monitor-config";

export type MonitoringEnv = {
  MONGODB_URI?: string;
  MONITORING_ENABLED?: string;
  SMTP_ENABLED?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM?: string;
  SMTP_FROM_NAME?: string;
};

export interface MonitoringSettings {
  _id: "global";
  defaultIntervalMinutes: number;
  failureRecheckMinutes: number;
  failureThreshold: number;
  recoveryThreshold: number;
  reminderMinutes: number;
  alertRecipients: string[];
  emailEnabled: boolean;
  monitoringEnabled: boolean;
  updatedAt?: Date;
}

export const DEFAULT_SETTINGS: MonitoringSettings = {
  _id: "global",
  defaultIntervalMinutes: 10,
  failureRecheckMinutes: 1,
  failureThreshold: 3,
  recoveryThreshold: 2,
  reminderMinutes: 5,
  alertRecipients: [],
  emailEnabled: false,
  monitoringEnabled: false,
};

const clamp = (value: unknown, fallback: number, min: number, max: number) =>
  Number.isInteger(value) && Number(value) >= min && Number(value) <= max
    ? Number(value)
    : fallback;

export function normalizeSettings(raw: Partial<MonitoringSettings> | null): MonitoringSettings {
  const settings = raw ?? {};
  return {
    _id: "global",
    defaultIntervalMinutes: clamp(settings.defaultIntervalMinutes, 10, 1, 60),
    failureRecheckMinutes: clamp(settings.failureRecheckMinutes, 1, 1, 10),
    failureThreshold: clamp(settings.failureThreshold, 3, 1, 20),
    recoveryThreshold: clamp(settings.recoveryThreshold, 2, 1, 20),
    reminderMinutes: clamp(settings.reminderMinutes, 5, 5, 1440),
    alertRecipients: Array.isArray(settings.alertRecipients)
      ? [...new Set(settings.alertRecipients.filter((address): address is string =>
          typeof address === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)
        ))].slice(0, 10)
      : [],
    emailEnabled: settings.emailEnabled === true,
    monitoringEnabled: settings.monitoringEnabled === true,
    updatedAt: settings.updatedAt,
  };
}

export async function withMonitoringDb<T>(
  env: MonitoringEnv,
  action: (db: Db) => Promise<T>
): Promise<T> {
  if (!env.MONGODB_URI) throw new Error("MONGODB_URI is not configured");
  const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000, maxPoolSize: 3 });
  try {
    await client.connect();
    return await action(client.db("biosec_monitoring"));
  } finally {
    await client.close();
  }
}

export async function readSettings(db: Db): Promise<MonitoringSettings> {
  const raw = await db.collection<MonitoringSettings>("monitoring_settings").findOne({ _id: "global" });
  return normalizeSettings(raw);
}

export type StoredMonitor = Document & Partial<MonitorFields> & {
  _id: import("mongodb").ObjectId;
  name: string;
  type: "https";
  url: string;
  expectedStatus?: number;
  enabled: boolean;
  intervalMinutes?: number;
  nextCheckAt?: Date;
  leaseUntil?: Date | null;
  consecutiveFailures?: number;
  consecutiveSuccesses?: number;
  status?: "unknown" | "up" | "down";
};

export async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection("monitored_services").createIndex({ enabled: 1, nextCheckAt: 1 }),
    db.collection("health_checks").createIndex({ checkedAt: 1 }, { expireAfterSeconds: 90 * 86400 }),
    db.collection("incidents").createIndex({ monitorId: 1, status: 1 }),
    db.collection("alert_notifications").createIndex({ incidentId: 1, kind: 1, createdAt: 1 }),
  ]);
}

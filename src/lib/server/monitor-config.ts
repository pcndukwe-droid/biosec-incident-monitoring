/** Shared validation for monitor configuration and scheduled execution. */
export type HttpMethod = "GET" | "POST";
export type MonitorFields = {
  method: HttpMethod;
  requestBody: string | null;
  responseCheck: "status" | "json-nonempty" | "json-field";
  responseField: string | null;
};
export function validateMonitorTarget(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      (url.port && url.port !== "443")) {
    throw new Error("Only public HTTPS endpoints on port 443 without credentials or fragments are supported");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
  if (!host.includes(".") || ipv4 || host.includes(":") ||
      host === "localhost" || host.endsWith(".localhost") ||
      [".local",".internal",".test",".invalid",".example",".onion",".lan"].some(s=>host.endsWith(s)) ||
      host === "metadata.google.internal" || host === "169.254.169.254") {
    throw new Error("Use a public HTTPS hostname; private IPs and internal network services are not allowed");
  }
  url.hostname = host;
  return url;
}

export function parseMonitorFields(input: Record<string, unknown>): MonitorFields {
  const method = input.method ?? "GET";
  if (method !== "GET" && method !== "POST") throw new Error("HTTP method must be GET or POST");
  const responseCheck = input.responseCheck ?? "status";
  if (responseCheck !== "status" && responseCheck !== "json-nonempty" && responseCheck !== "json-field")
    throw new Error("Choose a valid response validation mode");
  const responseField = input.responseField == null || input.responseField === "" ? null : input.responseField;
  if (responseField !== null && (typeof responseField !== "string" ||
    !/^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*){0,7}$/.test(responseField) ||
    responseField.length > 160 ||
    responseField.split(".").some(v=>["__proto__","prototype","constructor"].includes(v)))) {
    throw new Error("Response field must be a dot-separated JSON property path (for example: data.prices)");
  }
  if (responseCheck === "json-field" && !responseField)
    throw new Error("Specify the JSON response field to validate");
  if (input.requestBody !== undefined && input.requestBody !== null && typeof input.requestBody !== "string")
    throw new Error("Request body must be valid JSON text");
  const raw = typeof input.requestBody === "string" ? input.requestBody.trim() : "";
  if (raw.length > 4096) throw new Error("Request JSON cannot exceed 4,096 characters");
  if (method === "GET" && raw) throw new Error("GET monitors cannot send a JSON request body");
  if (raw) {
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new Error("Request body must contain valid JSON"); }
    if (body === null || typeof body !== "object" || Array.isArray(body))
      throw new Error("Request body must be a JSON object");
  }
  return {
    method,
    requestBody: method === "POST" ? (raw || null) : null,
    responseCheck,
    responseField: responseCheck === "json-field" ? responseField as string : null,
  };
}

export function verifyResponseJson(payload: unknown, mode: MonitorFields["responseCheck"], field: string | null): boolean {
  if (!payload || typeof payload !== "object") return false;
  const hasValue = (v: unknown): boolean => {
    if (v === null || v === undefined || v === false || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v).length > 0;
    return true;
  };
  if (mode === "json-nonempty") return hasValue(payload);
  if (mode === "json-field" && field) {
    let current: unknown = payload;
    for (const part of field.split(".")) {
      if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current,part)) return false;
      current = (current as Record<string,unknown>)[part];
    }
    return hasValue(current);
  }
  return true;
}

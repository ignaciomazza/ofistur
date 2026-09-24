function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

export function extractPemPair(data: unknown): { certPem: string; keyPem: string } {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const certPem = pickString(record, ["cert", "certificate", "cert_pem", "certPem", "crt"]);
  const keyPem = pickString(record, ["key", "private_key", "privateKey", "key_pem", "keyPem"]);
  if (!certPem || !keyPem) throw new Error("Afip SDK no devolvió cert/key");
  return { certPem, keyPem };
}

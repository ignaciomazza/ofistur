import type { NextApiRequest, NextApiResponse } from "next";
import { isIP } from "node:net";
import { resolveAuth } from "@/lib/auth";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const FETCH_TIMEOUT_MS = 15_000;

const ALLOWED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

function firstQueryValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return String(value ?? "").trim();
}

function isPrivateIpv4(hostname: string): boolean {
  const [a, b] = hostname.split(".").map((segment) => Number(segment));
  if (![a, b].every((n) => Number.isInteger(n))) return false;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isPrivateIpv6(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "::1") return true;
  if (host.startsWith("fe80:")) return true;
  if (host.startsWith("fc") || host.startsWith("fd")) return true;
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();
  if (!host) return true;
  if (host === "localhost") return true;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;

  const ipVersion = isIP(host);
  if (ipVersion === 4) return isPrivateIpv4(host);
  if (ipVersion === 6) return isPrivateIpv6(host);

  return false;
}

function normalizeImageMime(contentType: string | null): string | null {
  const ct = String(contentType ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!ct) return null;
  return ALLOWED_IMAGE_MIME.has(ct) ? ct : null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const auth = await resolveAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const rawUrl = firstQueryValue(req.query.url);
  if (!rawUrl) {
    return res.status(400).json({ error: "Falta parámetro 'url'" });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return res.status(400).json({ error: "URL inválida" });
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    return res.status(400).json({ error: "Protocolo no permitido" });
  }
  if (target.username || target.password) {
    return res.status(400).json({ error: "URL no permitida" });
  }
  if (isBlockedHostname(target.hostname)) {
    return res.status(400).json({ error: "Host no permitido" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "Ofistur-PDF-Image-Proxy/1.0",
      },
    });

    if (!upstream.ok) {
      return res.status(422).json({
        error: `No se pudo descargar la imagen (status ${upstream.status})`,
      });
    }

    const contentLength = Number(upstream.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: "Imagen demasiado grande" });
    }

    const mime = normalizeImageMime(upstream.headers.get("content-type"));
    if (!mime) {
      return res
        .status(415)
        .json({ error: "Formato de imagen no soportado para PDF" });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length === 0) {
      return res.status(422).json({ error: "La imagen descargada está vacía" });
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: "Imagen demasiado grande" });
    }

    const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.status(200).json({
      dataUrl,
      contentType: mime,
      bytes: buffer.length,
    });
  } catch (error) {
    const isTimeout =
      error instanceof DOMException && error.name === "AbortError";
    return res.status(isTimeout ? 504 : 500).json({
      error: isTimeout
        ? "Timeout al descargar la imagen"
        : "No se pudo procesar la imagen",
    });
  } finally {
    clearTimeout(timeout);
  }
}

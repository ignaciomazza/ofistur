import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify, JWTPayload } from "jose";

const JWT_SECRET = process.env.JWT_SECRET as string;
const DBG =
  process.env.DEBUG_AUTH === "1" || process.env.NEXT_PUBLIC_DEBUG_AUTH === "1";

type MyJWTPayload = JWTPayload & {
  userId?: number;
  id_user?: number;
  role?: string;
};

function normalizeRole(r?: string) {
  const normalized = (r ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
  if (!normalized) return "";
  if (normalized === "admin" || normalized.startsWith("administr")) {
    return "administrativo";
  }
  if (normalized.startsWith("gerent")) return "gerente";
  if (["dev", "developer"].includes(normalized)) return "desarrollador";
  if (normalized.startsWith("desarrollador")) return "desarrollador";
  if (normalized === "leader") return "lider";
  if (normalized.startsWith("lider")) return "lider";
  return normalized;
}

async function verifyToken(token: string): Promise<MyJWTPayload | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(JWT_SECRET),
    );
    return payload as MyJWTPayload;
  } catch {
    if (DBG) console.warn("[AUTH-DEBUG][MW] jwtVerify failed");
    return null;
  }
}

function pickToken(req: NextRequest): {
  token: string | null;
  source: "authorization" | "cookie" | null;
  hasAuthHeader: boolean;
  hasCookie: boolean;
} {
  const auth = req.headers.get("authorization");
  const cookieToken = req.cookies.get("token")?.value ?? null;
  const hasAuthHeader = !!(auth && auth.startsWith("Bearer "));
  const hasCookie = !!cookieToken;

  if (hasAuthHeader)
    return {
      token: auth!.slice(7),
      source: "authorization",
      hasAuthHeader,
      hasCookie,
    };
  if (hasCookie)
    return { token: cookieToken, source: "cookie", hasAuthHeader, hasCookie };
  return { token: null, source: null, hasAuthHeader, hasCookie };
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  // Públicas
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/api/auth/session")
  ) {
    if (DBG) console.info("[AUTH-DEBUG][MW]", reqId, "pass public", pathname);
    const res = NextResponse.next();
    if (DBG) res.headers.set("x-auth-public", "1");
    return res;
  }

  const { token, source, hasAuthHeader, hasCookie } = pickToken(req);

  if (DBG) {
    console.info("[AUTH-DEBUG][MW]", reqId, "incoming", {
      path: pathname,
      hasAuthHeader,
      hasCookie,
      chosenSource: source,
      ua: req.headers.get("user-agent") || "",
    });
  }

  if (!token) {
    const reason = "no-token";
    if (pathname.startsWith("/api")) {
      const res = NextResponse.json(
        { error: "Unauthorized", reason },
        { status: 401 },
      );
      res.headers.set("x-auth-reason", reason);
      res.headers.set("x-auth-source", "none");
      return res;
    }
    const r = NextResponse.redirect(new URL("/login", req.url));
    r.headers.set("x-auth-reason", reason);
    r.headers.set("x-auth-source", "none");
    if (DBG) console.warn("[AUTH-DEBUG][MW]", reqId, "deny", reason);
    return r;
  }

  const payload = await verifyToken(token);
  if (!payload?.role) {
    const reason = "invalid-token-or-no-role";
    if (pathname.startsWith("/api")) {
      const res = NextResponse.json(
        { error: "Unauthorized", reason },
        { status: 401 },
      );
      res.headers.set("x-auth-reason", reason);
      res.headers.set("x-auth-source", source || "unknown");
      return res;
    }
    const r = NextResponse.redirect(new URL("/login", req.url));
    r.headers.set("x-auth-reason", reason);
    r.headers.set("x-auth-source", source || "unknown");
    if (DBG) console.warn("[AUTH-DEBUG][MW]", reqId, "deny", reason);
    return r;
  }

  const role = normalizeRole(payload.role);
  const userId = Number(payload.userId ?? payload.id_user ?? 0) || 0;

  // Guards por rol (incluye páginas y APIs sensibles)
  let allowed: string[] = [];
  if (
    /^\/groups(\/|$)/.test(pathname) ||
    /^\/api\/groups(\/|$)/.test(pathname)
  ) {
    allowed = ["desarrollador"];
  } else if (!pathname.startsWith("/api")) {
    if (/^\/(teams|agency)(\/|$)/.test(pathname)) {
      allowed = ["desarrollador", "gerente"];
    } else if (
      /^\/operators(\/|$)/.test(pathname) &&
      !pathname.startsWith("/operators/insights")
    ) {
      allowed = ["desarrollador", "administrativo", "gerente"];
    } else if (/^\/users(\/|$)/.test(pathname)) {
      allowed = ["desarrollador", "gerente"];
    }
  }
  if (allowed.length && !allowed.includes(role)) {
    if (pathname.startsWith("/api")) {
      const res = NextResponse.json(
        { error: "Forbidden", reason: "role-not-allowed" },
        { status: 403 },
      );
      res.headers.set("x-auth-reason", "role-not-allowed");
      res.headers.set("x-auth-role", role);
      return res;
    }
    const r = NextResponse.redirect(new URL("/", req.url));
    r.headers.set("x-auth-reason", "role-not-allowed");
    r.headers.set("x-auth-role", role);
    if (DBG)
      console.warn("[AUTH-DEBUG][MW]", reqId, "deny role-not-allowed", {
        path: pathname,
        role,
        allowed,
      });
    return r;
  }

  // Propagar tanto en request como en response (útil para ver desde el navegador)
  const res = NextResponse.next({
    request: {
      headers: new Headers({
        ...Object.fromEntries(req.headers),
        "x-user-id": String(userId),
        "x-user-role": role,
        "x-auth-source": source || "unknown",
      }),
    },
  });
  if (DBG) {
    res.headers.set("x-user-id", String(userId));
    res.headers.set("x-user-role", role);
    res.headers.set("x-auth-source", source || "unknown");
  }
  if (DBG) console.info("[AUTH-DEBUG][MW]", reqId, "allow", { role, userId });
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "repo_ai_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export class AuthConfigurationError extends Error {
    constructor() {
        super("Authentication is not configured.");
        this.name = "AuthConfigurationError";
    }
}

export function getSessionKey(): Uint8Array {
    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
        throw new AuthConfigurationError();
    }
    return new TextEncoder().encode(secret);
}

export async function createSessionToken(userId: string, sessionVersion = 0): Promise<string> {
    return new SignJWT({ sv: sessionVersion })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(userId)
        .setIssuer("repo-ai")
        .setAudience("repo-ai-session")
        .setIssuedAt()
        .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
        .sign(getSessionKey());
}

export async function getSessionClaims(token: string): Promise<{ userId: string; sessionVersion: number } | null> {
    try {
        const { payload } = await jwtVerify(token, getSessionKey(), {
            algorithms: ["HS256"],
            issuer: "repo-ai",
            audience: "repo-ai-session"
        });
        if (typeof payload.sub !== "string") return null;
        const sessionVersion = payload.sv === undefined ? 0 : payload.sv;
        if (typeof sessionVersion !== "number" || !Number.isInteger(sessionVersion) || sessionVersion < 0) return null;
        return { userId: payload.sub, sessionVersion };
    } catch {
        return null;
    }
}

function cookieSameSite(): "lax" | "strict" | "none" {
    const defaultValue = process.env.NODE_ENV === "production" ? "none" : "lax";
    const value = (process.env.AUTH_COOKIE_SAME_SITE || defaultValue).toLowerCase();
    if (value === "lax" || value === "strict" || value === "none") return value;
    throw new Error("AUTH_COOKIE_SAME_SITE must be lax, strict, or none");
}

function cookieAttributes(maxAge: number): string {
    const sameSite = cookieSameSite();
    const secure = process.env.NODE_ENV === "production";
    if (sameSite === "none" && !secure) {
        throw new Error("SameSite=None cookies require production HTTPS");
    }
    return [
        "Path=/",
        "HttpOnly",
        `SameSite=${sameSite[0].toUpperCase()}${sameSite.slice(1)}`,
        `Max-Age=${maxAge}`,
        ...(secure ? ["Secure"] : [])
    ].join("; ");
}

export function sessionCookie(token: string): string {
    return `${SESSION_COOKIE}=${token}; ${cookieAttributes(SESSION_MAX_AGE_SECONDS)}`;
}

export function clearedSessionCookie(): string {
    return `${SESSION_COOKIE}=; ${cookieAttributes(0)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

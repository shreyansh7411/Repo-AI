import path from "node:path";

export function validateProductionEnvironment(): void {
    const sameSite = (process.env.AUTH_COOKIE_SAME_SITE || "lax").toLowerCase();
    if (!["lax", "strict", "none"].includes(sameSite)) {
        throw new Error("AUTH_COOKIE_SAME_SITE must be lax, strict, or none");
    }
    if (sameSite === "none" && process.env.NODE_ENV !== "production") {
        throw new Error("SameSite=None cookies require production HTTPS");
    }

    if (process.env.NODE_ENV !== "production") return;

    if (!process.env.AUTH_JWT_SECRET || Buffer.byteLength(process.env.AUTH_JWT_SECRET, "utf8") < 32) {
        throw new Error("AUTH_JWT_SECRET must contain at least 32 bytes in production");
    }

    const origin = process.env.CORS_ORIGIN;
    if (!origin) throw new Error("CORS_ORIGIN is required in production");
    let parsedOrigin: URL;
    try {
        parsedOrigin = new URL(origin);
    } catch {
        throw new Error("CORS_ORIGIN must be a valid HTTPS origin");
    }
    if (parsedOrigin.protocol !== "https:" || parsedOrigin.origin !== origin) {
        throw new Error("CORS_ORIGIN must be a valid HTTPS origin");
    }

    const storagePath = process.env.REPOSITORY_STORAGE_PATH;
    if (!storagePath || !path.isAbsolute(storagePath)) {
        throw new Error("REPOSITORY_STORAGE_PATH must be an absolute path in production");
    }
}

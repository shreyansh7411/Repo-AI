import path from "node:path";

export function validateProductionEnvironment(): void {
    if (process.env.NODE_ENV !== "production") return;

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

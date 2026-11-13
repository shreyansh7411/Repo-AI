import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Pool } = pg;

function productionSsl() {
    if (process.env.NODE_ENV !== "production") return undefined;

    const mode = process.env.DB_SSL_MODE;
    if (mode === "disable") return false;
    if (mode === "require") return { rejectUnauthorized: false };
    if (mode === "verify-full") return { rejectUnauthorized: true };

    throw new Error("DB_SSL_MODE must be disable, require, or verify-full in production");
}

const databaseUrl = process.env.DATABASE_URL;

if (process.env.NODE_ENV === "production" && !databaseUrl) {
    throw new Error("DATABASE_URL is required in production");
}

const ssl = productionSsl();
let connectionString = databaseUrl;
if (databaseUrl && process.env.NODE_ENV === "production") {
    const parsed = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname) {
        throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
    }
    parsed.searchParams.delete("sslmode");
    connectionString = parsed.toString();
}

export const pool = databaseUrl
    ? new Pool({ connectionString, ssl })
    : new Pool({
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || "repo-ai",
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD,
        ssl
    });

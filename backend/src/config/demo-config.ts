export interface DemoConfig {
    enabled: boolean;
    sessionTtlMinutes: number;
    maxActiveSessions: number;
    maxConcurrentIndexes: number;
    maxRepositorySizeMb: number;
    maxIndexDurationSeconds: number;
    maxFiles: number;
    maxFilesystemEntries: number;
    maxFileSizeMb: number;
    rateLimitWindowSeconds: number;
    maxIndexRequestsPerWindow: number;
    maxReadRequestsPerWindow: number;
    cleanupIntervalSeconds: number;
    rateLimitSecret: string;
}

function integerSetting(name: string, fallback: number, minimum: number, maximum: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
}

export function getDemoConfig(): DemoConfig {
    const enabledValue = (process.env.DEMO_ENABLED ?? "false").toLowerCase();
    if (enabledValue !== "true" && enabledValue !== "false") {
        throw new Error("DEMO_ENABLED must be true or false");
    }
    const enabled = enabledValue === "true";
    const rateLimitSecret = process.env.DEMO_RATE_LIMIT_SECRET ?? "";
    if (enabled && Buffer.byteLength(rateLimitSecret, "utf8") < 32) {
        throw new Error("DEMO_RATE_LIMIT_SECRET must contain at least 32 bytes when demo mode is enabled");
    }

    return {
        enabled,
        sessionTtlMinutes: integerSetting("DEMO_SESSION_TTL_MINUTES", 120, 15, 1440),
        maxActiveSessions: integerSetting("DEMO_MAX_ACTIVE_SESSIONS", 10, 1, 500),
        maxConcurrentIndexes: integerSetting("DEMO_MAX_CONCURRENT_INDEXES", 2, 1, 16),
        maxRepositorySizeMb: integerSetting("DEMO_MAX_REPO_SIZE_MB", 100, 1, 2048),
        maxIndexDurationSeconds: integerSetting("DEMO_MAX_INDEX_DURATION_SECONDS", 180, 15, 1800),
        maxFiles: integerSetting("DEMO_MAX_FILES", 2500, 1, 50000),
        maxFilesystemEntries: integerSetting("DEMO_MAX_FILESYSTEM_ENTRIES", 25000, 100, 1_000_000),
        maxFileSizeMb: integerSetting("DEMO_MAX_FILE_SIZE_MB", 5, 1, 100),
        rateLimitWindowSeconds: integerSetting("DEMO_RATE_LIMIT_WINDOW_SECONDS", 3600, 60, 86400),
        maxIndexRequestsPerWindow: integerSetting("DEMO_MAX_INDEX_REQUESTS_PER_WINDOW", 3, 1, 100),
        maxReadRequestsPerWindow: integerSetting("DEMO_MAX_READ_REQUESTS_PER_WINDOW", 120, 10, 5000),
        cleanupIntervalSeconds: integerSetting("DEMO_CLEANUP_INTERVAL_SECONDS", 60, 10, 3600),
        rateLimitSecret
    };
}

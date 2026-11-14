import { createHmac } from "node:crypto";
import type { Request } from "express";
import { pool } from "../config/database.js";
import { getDemoConfig } from "../config/demo-config.js";
import { DemoRequestError } from "./github-repository.js";

export async function enforceDemoRateLimit(request: Request, action: "index" | "read", sessionId?: string): Promise<void> {
    const config = getDemoConfig();
    const address = request.ip || request.socket.remoteAddress || "unknown";
    // Preserve the existing IP bucket key; session IDs are HMACed into a separate namespace.
    const bucketIdentity = sessionId ? `demo-session:${sessionId}` : address;
    const clientHash = createHmac("sha256", config.rateLimitSecret).update(bucketIdentity).digest("hex");
    const now = Date.now();
    const windowMs = config.rateLimitWindowSeconds * 1000;
    const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
    const expiresAt = new Date(windowStart.getTime() + windowMs);
    const bucketAction = sessionId ? "session-read" : action;
    const limit = action === "index" ? config.maxIndexRequestsPerWindow : config.maxReadRequestsPerWindow;
    const result = await pool.query<{ requestCount: number }>(
        `INSERT INTO demo_rate_limits (client_hash, action, window_started_at, request_count, expires_at)
         VALUES ($1, $2, $3, 1, $4)
         ON CONFLICT (client_hash, action, window_started_at)
         DO UPDATE SET request_count = demo_rate_limits.request_count + 1
         RETURNING request_count AS "requestCount"`,
        [clientHash, bucketAction, windowStart, expiresAt]
    );
    const count = result.rows[0]?.requestCount ?? 0;
    if (count > limit) {
        const retryAfter = Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000));
        throw new DemoRequestError(429, "Too many demo requests. Please wait before trying again.", "DEMO_RATE_LIMITED", retryAfter);
    }
}

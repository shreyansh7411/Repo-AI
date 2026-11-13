import type { NextFunction, Request, Response } from "express";

const windowMs = 15 * 60 * 1000;
const maxAttempts = 10;
const attemptsByAddress = new Map<string, { count: number; resetAt: number }>();
let requestsSinceCleanup = 0;

export function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    if (++requestsSinceCleanup >= 256) {
        requestsSinceCleanup = 0;
        for (const [address, bucket] of attemptsByAddress) {
            if (bucket.resetAt <= now) attemptsByAddress.delete(address);
        }
    }

    const address = req.ip || req.socket.remoteAddress || "unknown";
    let bucket = attemptsByAddress.get(address);
    if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowMs };
        attemptsByAddress.set(address, bucket);
    }

    if (bucket.count >= maxAttempts) {
        res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
        res.status(429).json({ error: "Too many login attempts. Please try again later." });
        return;
    }

    bucket.count += 1;
    next();
}

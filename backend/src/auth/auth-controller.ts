import type { Request, Response } from "express";
import { authenticateUser, getUserById, registerUser } from "./auth-service.js";
import { AuthConfigurationError, clearedSessionCookie, createSessionToken, getSessionKey, sessionCookie } from "./session.js";

function inputError(res: Response): Response {
    return res.status(400).json({ error: "Provide a valid name, email, and password." });
}

function normalizeEmail(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const email = value.trim().toLowerCase();
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    return email;
}

function validPassword(value: unknown): value is string {
    return typeof value === "string" && value.length >= 12 && value.length <= 128;
}

function authFailure(res: Response, error: unknown, operation: string): Response {
    if (error instanceof AuthConfigurationError) {
        return res.status(503).json({ error: "Authentication is not configured." });
    }
    console.error(`Authentication ${operation} failed.`);
    return res.status(500).json({ error: "Authentication could not be completed." });
}

export async function registerHandler(req: Request, res: Response): Promise<Response> {
    const body: unknown = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return inputError(res);
    const { name, email, password } = body as Record<string, unknown>;
    const normalizedEmail = normalizeEmail(email);
    if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 120 || !normalizedEmail || !validPassword(password)) {
        return inputError(res);
    }

    try {
        getSessionKey();
        const user = await registerUser(name.trim(), normalizedEmail, password);
        if (!user) return res.status(409).json({ error: "An account with this email already exists." });
        const token = await createSessionToken(user.id);
        res.append("Set-Cookie", sessionCookie(token));
        return res.status(201).json({ user });
    } catch (error) {
        return authFailure(res, error, "registration");
    }
}

export async function loginHandler(req: Request, res: Response): Promise<Response> {
    const body: unknown = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return inputError(res);
    const { email, password } = body as Record<string, unknown>;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || typeof password !== "string" || password.length < 1 || password.length > 128) return inputError(res);

    try {
        getSessionKey();
        const user = await authenticateUser(normalizedEmail, password);
        if (!user) return res.status(401).json({ error: "Invalid email or password." });
        const token = await createSessionToken(user.id);
        res.append("Set-Cookie", sessionCookie(token));
        return res.json({ user });
    } catch (error) {
        return authFailure(res, error, "login");
    }
}

export function logoutHandler(_req: Request, res: Response): Response {
    res.append("Set-Cookie", clearedSessionCookie());
    return res.json({ message: "Logged out." });
}

export async function meHandler(req: Request, res: Response): Promise<Response> {
    try {
        const user = req.auth ? await getUserById(req.auth.userId) : null;
        if (!user) return res.status(401).json({ error: "Authentication required." });
        return res.json({ user });
    } catch {
        return res.status(500).json({ error: "Authentication status could not be loaded." });
    }
}

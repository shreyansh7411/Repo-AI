import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultStoragePath = fileURLToPath(new URL("../../../repositories/", import.meta.url));

export function getRepositoryStoragePath(): string {
    return path.resolve(process.env.REPOSITORY_STORAGE_PATH || defaultStoragePath);
}

export function getRepositoryClonePath(repositoryId: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(repositoryId)) {
        throw new Error("Invalid repository identifier");
    }

    const root = getRepositoryStoragePath();
    const clonePath = path.resolve(root, repositoryId);
    const relative = path.relative(root, clonePath);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
        throw new Error("Repository clone path is outside the configured storage directory");
    }
    return clonePath;
}

export function validateRepositoryName(value: unknown): string {
    if (typeof value !== "string") throw new Error("Repository name is invalid");
    const name = value.trim();
    if (name.length < 1 || name.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name === "." || name === "..") {
        throw new Error("Repository name is invalid");
    }
    return name;
}

export function validateGitUrl(value: unknown): string {
    if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) {
        throw new Error("Repository URL is invalid");
    }

    const url = value.trim();
    if (/^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+:[^\s]+$/.test(url)) return url;

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error("Repository URL is invalid");
    }
    if (!["http:", "https:", "ssh:", "git:"].includes(parsed.protocol) || !parsed.hostname) {
        throw new Error("Repository URL must use HTTP, HTTPS, SSH, or Git");
    }
    return url;
}

export function sanitizeGitUrl(value: string): string {
    const scp = value.match(/^((?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+:)(.+)$/);
    if (scp && !value.includes("://")) return `${scp[1]}${scp[2].split("?")[0].split("#")[0]}`;

    try {
        const parsed = new URL(value);
        parsed.username = parsed.protocol === "ssh:" && parsed.username === "git" ? "git" : "";
        parsed.password = "";
        for (const key of [...parsed.searchParams.keys()]) {
            if (/token|password|secret|auth|credential|key/i.test(key)) parsed.searchParams.delete(key);
        }
        parsed.hash = "";
        return parsed.toString();
    } catch {
        return "[redacted-git-url]";
    }
}

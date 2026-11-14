export class DemoRequestError extends Error {
    constructor(readonly status: number, message: string, readonly code: string, readonly retryAfterSeconds?: number) { super(message); }
}

export interface PublicGitHubRepository {
    owner: string;
    name: string;
    cloneUrl: string;
    sizeBytes: number;
}

export function parsePublicGitHubUrl(input: unknown): { owner: string; name: string; cloneUrl: string } {
    if (typeof input !== "string" || input.length > 2048 || /[\u0000-\u0020\u007f]/.test(input)) {
        throw new DemoRequestError(400, "Enter a public GitHub repository URL.", "INVALID_GITHUB_URL");
    }
    let url: URL;
    try { url = new URL(input.trim()); }
    catch { throw new DemoRequestError(400, "Enter a valid public GitHub repository URL.", "INVALID_GITHUB_URL"); }
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.port || url.username || url.password || url.search || url.hash) {
        throw new DemoRequestError(400, "Only public repositories hosted at https://github.com are supported.", "INVALID_GITHUB_URL");
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2 || !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[0]) || !/^[A-Za-z0-9_.-]{1,100}(?:\.git)?$/.test(parts[1])) {
        throw new DemoRequestError(400, "Use a GitHub repository URL in the form https://github.com/owner/repository.", "INVALID_GITHUB_URL");
    }
    const owner = parts[0];
    const name = parts[1].replace(/\.git$/i, "");
    if (!name || name === "." || name === "..") {
        throw new DemoRequestError(400, "The GitHub repository name is invalid.", "INVALID_GITHUB_URL");
    }
    return { owner, name, cloneUrl: `https://github.com/${owner}/${name}.git` };
}

export async function verifyPublicGitHubRepository(
    input: unknown,
    maxSizeBytes: number
): Promise<PublicGitHubRepository> {
    const parsed = parsePublicGitHubUrl(input);
    let response: Response;
    try {
        response = await fetch(`https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}`, {
            headers: { Accept: "application/vnd.github+json", "User-Agent": "repo-ai-anonymous-demo" },
            signal: AbortSignal.timeout(10_000)
        });
    } catch {
        throw new DemoRequestError(503, "GitHub could not be reached. Please try again shortly.", "GITHUB_UNAVAILABLE");
    }
    if (new URL(response.url).hostname !== "api.github.com") {
        throw new DemoRequestError(400, "The GitHub repository could not be verified.", "GITHUB_VERIFICATION_FAILED");
    }
    if (response.status === 404) {
        throw new DemoRequestError(404, "The repository was not found or is not public.", "PUBLIC_REPOSITORY_REQUIRED");
    }
    if (response.status === 403 || response.status === 429) {
        throw new DemoRequestError(429, "GitHub is rate limiting repository checks. Please try again later.", "GITHUB_RATE_LIMITED");
    }
    if (!response.ok) {
        throw new DemoRequestError(503, "GitHub could not verify this repository. Please try again later.", "GITHUB_UNAVAILABLE");
    }
    const metadata: unknown = await response.json();
    if (!metadata || typeof metadata !== "object") {
        throw new DemoRequestError(503, "GitHub returned an invalid repository response.", "GITHUB_VERIFICATION_FAILED");
    }
    const data = metadata as Record<string, unknown>;
    if (data.private !== false || typeof data.size !== "number" || !Number.isFinite(data.size)) {
        throw new DemoRequestError(404, "The repository was not found or is not public.", "PUBLIC_REPOSITORY_REQUIRED");
    }
    const sizeBytes = Math.max(0, Math.floor(data.size * 1024));
    if (sizeBytes > maxSizeBytes) {
        throw new DemoRequestError(413, "This repository exceeds the anonymous demo size limit.", "REPOSITORY_TOO_LARGE");
    }
    return { ...parsed, sizeBytes };
}

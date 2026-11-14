import { spawn, type ChildProcess } from "node:child_process";
import { simpleGit } from "simple-git";
import fs from "fs/promises";
import path from "path";
import { sanitizeGitUrl } from "./repository-storage.js";

export async function cloneRepository(
    url: string,
    destination: string,
    options: { timeoutMs?: number; shallow?: boolean; maxBytes?: number; maxEntries?: number } = {}
): Promise<string> {
    const repositoryPath = path.resolve(destination);
    let destinationExists = true;

    try {
        await fs.access(repositoryPath);
    } catch {
        destinationExists = false;
    }

    if (destinationExists) {
        const entries = await fs.readdir(repositoryPath);

        if (entries.length > 0) {
            const git = simpleGit(repositoryPath);
            if (!(await git.checkIsRepo())) {
                throw new Error("Existing repository storage is not a valid Git repository");
            }
            const origin = (await git.getRemotes(true))
                .find(remote => remote.name === "origin")?.refs.fetch;
            if (!origin || sanitizeGitUrl(origin) !== sanitizeGitUrl(url)) {
                throw new Error("Existing clone origin does not match the requested repository");
            }
            const safeOrigin = sanitizeGitUrl(origin);
            if (safeOrigin !== origin) await git.remote(["set-url", "origin", safeOrigin]);
            return repositoryPath;
        }
    } else {
        await fs.mkdir(path.dirname(repositoryPath), {
            recursive: true
        });
    }

    if (options.maxBytes !== undefined && options.maxEntries !== undefined) {
        const abortController = new AbortController();
        let abortReason: Error | null = null;
        let cloneFinished = false;
        const monitorStopController = new AbortController();
        const timeoutMs = options.timeoutMs ?? Number.POSITIVE_INFINITY;
        const timeout = Number.isFinite(timeoutMs) ? setTimeout(() => {
            abortReason = new Error("Demo indexing exceeded the configured time limit.");
            abortController.abort();
        }, Math.max(1, timeoutMs)) : null;
        const deadlineAt = Number.isFinite(timeoutMs) ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;
        const monitor = monitorCloneLimits(repositoryPath, options.maxBytes, options.maxEntries, deadlineAt, abortController, monitorStopController.signal, () => cloneFinished, reason => { abortReason = reason; });

        try {
            await cloneWithProcessTree(url, repositoryPath, options.shallow, abortController.signal);
        } catch (error) {
            if (abortReason) throw abortReason;
            throw error;
        } finally {
            cloneFinished = true;
            monitorStopController.abort();
            if (timeout) clearTimeout(timeout);
            await monitor;
        }
        if (abortReason) throw abortReason;
    } else {
        const git = options.timeoutMs
            ? simpleGit({ timeout: { block: options.timeoutMs, stdErr: false, stdOut: false }, config: ["credential.helper="] })
            : simpleGit();
        await git.clone(url, repositoryPath, options.shallow ? ["--quiet", "--depth", "1", "--single-branch"] : []);
    }

    const clonedGit = simpleGit(repositoryPath);
    const safeUrl = sanitizeGitUrl(url);
    if (safeUrl !== url) await clonedGit.remote(["set-url", "origin", safeUrl]);

    return repositoryPath;
}

async function cloneWithProcessTree(url: string, repositoryPath: string, shallow = false, signal: AbortSignal): Promise<void> {
    const cloneArguments = [
        "-c",
        "credential.helper=",
        "clone",
        ...(shallow ? ["--quiet", "--depth", "1", "--single-branch"] : []),
        url,
        repositoryPath
    ];
    const child = spawn("git", cloneArguments, {
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", chunk => { stderr += chunk; });

    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        let childError: Error | null = null;
        const onError = (error: Error) => { childError = error; };
        const onClose = (code: number | null, exitSignal: NodeJS.Signals | null) => {
            child.removeListener("error", onError);
            if (childError) reject(childError);
            else resolve({ code, signal: exitSignal });
        };
        child.on("error", onError);
        child.once("close", onClose);
    });
    let termination: Promise<void> | undefined;
    const abort = () => {
        termination ??= terminateGitProcessTree(child, exited);
    };
    signal.addEventListener("abort", abort, { once: true });

    try {
        if (signal.aborted) abort();
        const result = await exited;
        if (termination) await termination;
        if (signal.aborted) throw new Error("Git clone was aborted.");
        if (result.code !== 0) {
            throw new Error(stderr.trim() || `Git clone exited with code ${result.code ?? "unknown"}.`);
        }
    } finally {
        signal.removeEventListener("abort", abort);
        if (termination) await termination;
    }
}

async function terminateGitProcessTree(
    child: ChildProcess,
    exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
): Promise<void> {
    let terminationError: unknown;
    try {
        if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;

        if (process.platform === "win32") {
            const taskkill = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
                windowsHide: true,
                stdio: "ignore"
            });
            const taskkillResult = await new Promise<{ code: number | null }>((resolve, reject) => {
                taskkill.once("error", reject);
                taskkill.once("close", code => resolve({ code }));
            });
            if (taskkillResult.code !== 0) {
                throw new Error(`Windows process-tree termination failed with exit code ${taskkillResult.code ?? "unknown"}.`);
            }
        } else {
            signalProcessGroup(child.pid, "SIGTERM");
            const exitedAfterTerm = await waitForExitOrTimeout(exited, 2_000);
            if (!exitedAfterTerm && child.exitCode === null && child.signalCode === null) {
                signalProcessGroup(child.pid, "SIGKILL");
            }
        }
    } catch (error) {
        terminationError = error;
    } finally {
        try {
            await exited;
        } catch (error) {
            terminationError ??= error;
        }
    }

    if (terminationError) throw terminationError;
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
    try {
        process.kill(-pid, signal);
    } catch (error) {
        if (!isProcessGoneError(error)) throw error;
    }
}

function isProcessGoneError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}

function waitForExitOrTimeout(
    exited: Promise<unknown>,
    milliseconds: number
): Promise<boolean> {
    return new Promise(resolve => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve(false);
        }, milliseconds);
        void exited.then(() => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(true);
        }, () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(true);
        });
    });
}

async function monitorCloneLimits(
    repositoryPath: string,
    maxBytes: number,
    maxEntries: number,
    deadlineAt: number,
    abortController: AbortController,
    stopSignal: AbortSignal,
    isFinished: () => boolean,
    setAbortReason: (reason: Error) => void
): Promise<void> {
    while (!isFinished() && !abortController.signal.aborted && !stopSignal.aborted) {
        try {
            const usage = await getRepositoryUsage(repositoryPath, maxBytes, maxEntries, deadlineAt, abortController.signal);
            if (isFinished() || stopSignal.aborted) return;
            if (Date.now() > deadlineAt) {
                setAbortReason(new Error("Demo indexing exceeded the configured time limit."));
                abortController.abort();
                return;
            }
            if (usage.entries > maxEntries) {
                setAbortReason(new Error("Repository exceeds the configured demo filesystem-entry limit."));
                abortController.abort();
                return;
            }
            if (usage.bytes > maxBytes) {
                setAbortReason(new Error("Repository exceeds the configured demo size limit."));
                abortController.abort();
                return;
            }
        } catch (error) {
            setAbortReason(error instanceof Error && error.message.includes("time limit")
                ? error
                : new Error("Demo clone resource limits could not be checked."));
            abortController.abort();
            return;
        }

        // This abort signal bounds the Git process tree; this delay bounds how
        // much additional data can arrive between filesystem measurements.
        await waitForMonitorDelay(200, [abortController.signal, stopSignal]);
    }
}

function waitForMonitorDelay(milliseconds: number, signals: AbortSignal[]): Promise<void> {
    if (signals.some(signal => signal.aborted)) return Promise.resolve();
    return new Promise(resolve => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            for (const signal of signals) signal.removeEventListener("abort", finish);
            resolve();
        };
        const timer = setTimeout(finish, milliseconds);
        for (const signal of signals) signal.addEventListener("abort", finish, { once: true });
    });
}

async function getRepositoryUsage(root: string, maxBytes: number, maxEntries: number, deadlineAt: number, signal: AbortSignal): Promise<{ bytes: number; entries: number }> {
    const pending = [root];
    let bytes = 0;
    let entries = 0;
    while (pending.length > 0) {
        if (signal.aborted) return { bytes, entries };
        if (Date.now() > deadlineAt) throw new Error("Demo indexing exceeded the configured time limit.");
        const current = pending.pop();
        if (!current) continue;
        let directory: Awaited<ReturnType<typeof fs.opendir>>;
        try {
            directory = await fs.opendir(current);
        } catch (error) {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") continue;
            throw error;
        }
        for await (const entry of directory) {
            if (signal.aborted) return { bytes, entries };
            if (Date.now() > deadlineAt) throw new Error("Demo indexing exceeded the configured time limit.");
            entries += 1;
            if (entries > maxEntries) return { bytes, entries };
            if (entry.isSymbolicLink()) continue;
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) pending.push(entryPath);
            else if (entry.isFile()) {
                try { bytes += (await fs.stat(entryPath)).size; }
                catch (error) {
                    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") continue;
                    throw error;
                }
                if (signal.aborted) return { bytes, entries };
                if (Date.now() > deadlineAt) throw new Error("Demo indexing exceeded the configured time limit.");
                if (bytes > maxBytes) return { bytes, entries };
            }
        }
    }
    return { bytes, entries };
}

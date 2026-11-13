import { simpleGit } from "simple-git";
import fs from "fs/promises";
import path from "path";
import { sanitizeGitUrl } from "./repository-storage.js";

export async function cloneRepository(
    url: string,
    destination: string
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

    await simpleGit().clone(url, repositoryPath);

    const clonedGit = simpleGit(repositoryPath);
    const safeUrl = sanitizeGitUrl(url);
    if (safeUrl !== url) await clonedGit.remote(["set-url", "origin", safeUrl]);

    return repositoryPath;
}

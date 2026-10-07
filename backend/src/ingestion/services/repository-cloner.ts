import { simpleGit } from "simple-git";
import fs from "fs/promises";
import path from "path";

const git = simpleGit();

export async function cloneRepository(
    url: string,
    destination: string
): Promise<string> {
    const repositoryPath = path.resolve(destination);

    try {
        await fs.access(repositoryPath);

        const entries = await fs.readdir(repositoryPath);

        if (entries.length > 0) {
            console.log(`Repository already exists at ${repositoryPath}`);
            return repositoryPath;
        }
    } catch {
        await fs.mkdir(path.dirname(repositoryPath), {
            recursive: true
        });
    }

    await git.clone(url, repositoryPath);

    return repositoryPath;
}

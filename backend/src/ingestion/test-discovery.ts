import { discoverFiles } from "./services/file-discovery.js";

const repositoryPath = "repositories/Ai-Finance-Controller";

const files = await discoverFiles(repositoryPath);

console.log(`Discovered ${files.length} source files`);

for (const file of files.slice(0, 20)) {
    console.log(
        `${file.language.padEnd(12)} ${file.relativePath}`
    );
}

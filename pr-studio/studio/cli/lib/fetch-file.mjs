// Prints a file of a GitHub repository at a commit (used synchronously by code.mjs through a child process).
// usage: node cli/lib/fetch-file.mjs <owner/repo> <sha> <path>
import { fileAt } from './github.mjs';

const [full, ref, filePath] = process.argv.slice(2);
try {
	process.stdout.write(await fileAt(full, ref, filePath));
} catch (error) {
	process.stderr.write(error.message);
	process.exitCode = 1;
}

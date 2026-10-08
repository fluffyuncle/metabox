import { join } from "@std/path/join";

export type JsonObject = Record<string, unknown>;

export interface FileEntry {
	path: string;
	type: string;
}

export function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function safeLoadJsonObject(path: string): JsonObject {
	const obj = JSON.parse(Deno.readTextFileSync(path));
	if (!isJsonObject(obj)) {
		throw new Error(`'${path}' must contain a JSON object at the root`);
	}
	return obj;
}

export function sortedEntries(dir: string): Deno.DirEntry[] {
	return [...Deno.readDirSync(dir)].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
}

export function withoutJsonExtension(name: string): string {
	return name.slice(0, -".json".length);
}

export function isJsonFile(entry: Deno.DirEntry): boolean {
	return entry.isFile && entry.name.endsWith(".json");
}

export function isDirectoryExist(path: string) {
	try {
		const stat = Deno.statSync(path);
		if (!stat || !stat.isDirectory) {
			return false;
		}
	} catch {
		return false;
	}
	return true;
}

export function loadFile(fileName: string): unknown {
	return JSON.parse(Deno.readTextFileSync(fileName));
}

export function loadArrayDirectory(dir: string): unknown[] {
	const values: unknown[] = [];

	for (const entry of sortedEntries(dir)) {
		if (entry.isDirectory) {
			throw new Error(
				`The array folder "${dir}" must not contain any subfolders.`,
			);
		}

		if (isJsonFile(entry)) {
			values.push(loadFile(join(dir, entry.name)));
		}
	}

	return values;
}

export function extendObjectFromDirectory(target: JsonObject, dir: string): void {
	const entries = sortedEntries(dir);
	const jsonStems = new Set(
		entries
			.filter(isJsonFile)
			.map((entry) => withoutJsonExtension(entry.name)),
	);

	for (const entry of entries) {
		if (entry.isDirectory && jsonStems.has(entry.name)) {
			throw new Error(
				`Conflict in "${dir}": there is both file "${entry.name}.json" ` +
					`and folder "${entry.name}/"`,
			);
		}
	}

	// First, the regular files: each one specifies the value of the property as a whole.
	for (const entry of entries) {
		if (isJsonFile(entry)) {
			const key = withoutJsonExtension(entry.name);
			target[key] = loadFile(join(dir, entry.name));
		}
	}

	// Nested folders are collected into arrays.
	for (const entry of entries) {
		if (entry.isDirectory) {
			target[entry.name] = loadArrayDirectory(join(dir, entry.name));
		}
	}
}

export function hasRequiredFiles(srcDir: string, requiredPaths: FileEntry[]): boolean {
	return requiredPaths.every(({ path, type }) => {
		const fullPath = join(srcDir, path);

		try {
			const stat = Deno.statSync(fullPath);
			return type === "file" ? stat.isFile : stat.isDirectory;
		} catch (err) {
			if (err instanceof Deno.errors.NotFound) return false;
			throw err;
		}
	});
}

export async function getOutput(
	path: string,
	args: string[],
	cwd?: string,
	env?: Record<string, string>,
): Promise<string> {
	const { success, code, stdout, stderr } = await new Deno.Command(path, {
		args,
		cwd,
		env,
		stdin: "null",
		stdout: "piped",
		stderr: "piped",
	}).output();

	if (!success) {
		const error = new TextDecoder().decode(stderr).trim();
		throw new Error(`${path} завершился с кодом ${code}: ${error}`);
	}

	return new TextDecoder().decode(stdout).trim();
}
import { join } from "@std/path/join";
import { downloadIfNotExist, FileDownloadable } from "../downloader.ts";
import { getOutput, isFileExist, isWindows } from "../utils.ts";
import { DELIMITER } from "@std/path/constants";
import { Result } from "../result.ts";
import { UntarStream } from "@std/tar/untar-stream";
import { normalize } from "@std/path/normalize";
import {
	ArchiveExtractor,
	extractArchive,
	getExtractorForFileName,
	StripFunction,
} from "./archive.ts";
import { resolve } from "@std/path/resolve";
import { dirname } from "@std/path/dirname";

class GoManifestFileEntry {
	constructor(
		readonly filename: string,
		readonly os: string = "",
		readonly arch: string = "",
		readonly version: string,
		readonly sha256: string,
		readonly size: number,
		readonly kind: "source" | "archive" | "installer",
	) {}
}

class GoManifestVersionEntry {
	constructor(
		readonly version: string,
		readonly stable: boolean,
		readonly files: readonly GoManifestFileEntry[],
	) {}
}

async function fetchGoManifest(): Promise<GoManifestVersionEntry[]> {
	const downloadable = new FileDownloadable(
		"https://go.dev/dl/?mode=json",
		join("cache", "go_manifest.json"),
	);
	const ok = await downloadIfNotExist(downloadable, "go_manifest.json"); // 86400 - 1 days after expire

	if (!ok) {
		return [];
	}

	return JSON.parse(
		Deno.readTextFileSync(downloadable.path),
	) as GoManifestVersionEntry[];
}

async function findGoRemoteCompability(): Promise<Result<GoManifestFileEntry>> {
	const manifest = await fetchGoManifest();

	for (const version of manifest) {
		if (!version.stable) continue;
		// let sourceCondidate: GoManifestFileEntry | null = null;
		const condidates: GoManifestFileEntry[] = [];
		for (const file of version.files) {
			// if(file.kind === "source") sourceCondidate = file;
			if (file.os === Deno.build.os) {
				let denoArch: string = Deno.build.arch;
				if (denoArch === "x86_64") {
					denoArch = "amd64";
				} else if (denoArch === "aarch64") {
					denoArch = "arm64";
				} else if (denoArch === "i386") {
					denoArch = "386";
				}
				condidates.push(file);
			}
		}
		const condidate = condidates.find((value) => value.kind === "archive");
		if (condidate) {
			return Result.success(condidate);
		}
	}

	return Result.error(
		"No suitable configuration for installing golang was found for your computer",
	);
}

function getPath(): string[] {
	const PATH = Deno.env.get("PATH");
	if (!PATH) return [];
	return PATH.split(DELIMITER);
}

class ToolVersion {
	constructor(
		readonly path: string,
		readonly version: string,
	) {}
}

async function findGoLocal(): Promise<Result<ToolVersion>> {
	const versionRegex = /go\d+(\.\d+)+/;

	let parent = null;

	for (const entry of getPath()) {
		const exePath = join(entry, `go${isWindows ? ".exe" : ""}`);
		if (!isFileExist(exePath)) {
			continue;
		}

		const output = await getOutput(exePath, ["version"]);
		if (!output.ok) {
			const tmpParent = parent;
			output.parent = tmpParent;
			parent = output;
			continue;
		}

		const match = output.data.match(versionRegex);
		if (match) {
			const fullVersion = match[0];
			return Result.success(new ToolVersion(exePath, fullVersion));
		}
	}

	return Result.error("Could not find installed golang", parent);
}

async function findGo(
	remoteForce: boolean = false,
): Promise<Result<ToolVersion>> {
	const goPathLatest = join("cache", "go_path.json");

	if (!remoteForce) {
		try {
			return Result.success(
				JSON.parse(await Deno.readTextFile(goPathLatest)),
			);
		} catch {
			const res = await findGoLocal();
			if (res.ok) {
				const data = res.data;
				await Deno.writeTextFile(goPathLatest, JSON.stringify(data));
				return Result.success(data);
			}
		}
	}

	// deno-lint-ignore no-explicit-any
	let result: Result<any>;

	result = await findGoRemoteCompability();
	if (!result.ok) return result;
	const remote: GoManifestFileEntry = result.data;

	result = getExtractorForFileName(remote.filename);
	if (!result.ok) return result;
	const archiveExtractor: ArchiveExtractor = result.data;

	const targetDir = resolve(
		join("cache"),
		`${archiveExtractor.withoutExtension(remote.filename)}`,
	);
	if(true) {
		console.log(`${targetDir}`);
		Deno.exit();
	}
	await Deno.mkdir(dirname(targetDir), { recursive: true });

	const stagingDir = await Deno.makeTempDir({
		dir: dirname(targetDir),
		prefix: ".prepare-asset-",
	});
	const zipPath = join("cache", remote.filename);

	const downloadable = new FileDownloadable(
		`https://go.dev/dl/${remote.filename}`,
		zipPath,
	);
	const ok = await downloadIfNotExist(downloadable);
	if (!ok) return Result.error(`Unable to download url ${downloadable.url}`);

	await extractArchive(zipPath, stagingDir, StripFunction.withDepths(1));
	try {
		await Deno.remove(targetDir, { recursive: true });
	} catch (error) {
		if (!(error instanceof Deno.errors.NotFound)) throw error;
	}
	await Deno.rename(stagingDir, targetDir);

	const toolVersion = new ToolVersion(
		join(targetDir, "bin", `go${isWindows ? ".exe" : ""}`),
		remote.version,
	);
	await Deno.writeTextFile(goPathLatest, JSON.stringify(toolVersion));

	return Result.success(toolVersion);
}

const tool = await findGo(true);
if(!tool.ok) {
	console.error(tool.stack);
	Deno.exit();
}
console.log(tool);

import { join } from "@std/path/join";
import { dirname } from "@std/path/dirname";
import { FileEntry, getOutput, hasRequiredFiles, isDirectoryExist } from "./utils.ts";
import { resolve } from "@std/path/resolve";
import { unzipDir } from "@stdx/zip/unzip";

interface MetaBox {
	workDir: string;
	boxExe: string;
}

function makeMetaBox(srcDir: string, buildDir: string): MetaBox {
	srcDir = resolve(srcDir);
	buildDir = resolve(buildDir);
	const outputPath = join(
		buildDir,
		Deno.build.os === "windows" ? "sing-box.exe" : "sing-box",
	);

	return {
		workDir: srcDir,
		boxExe: outputPath,
	} as MetaBox;
}

function prepareSingBox() {
	const srcDir = join(Deno.cwd(), "sing-box-src");
	return makeMetaBox(srcDir, Deno.cwd());
}

async function prepareAsset(srcDir: string): Promise<string | null> {
	const OWNER = "throneproj";
	const REPO = "sing-box";
	const COMMIT = "b4be66275d73b339647736d5276aa6b729d399d3";

	const url = `https://github.com/${OWNER}/${REPO}/archive/${COMMIT}.zip`;
	const targetDir = resolve(srcDir);

	await Deno.mkdir(dirname(targetDir), { recursive: true });

	const stagingDir = await Deno.makeTempDir({
		dir: dirname(targetDir),
		prefix: ".prepare-asset-",
	});
	const zipPath = await Deno.makeTempFile({ suffix: ".zip" });

	try {
		const res = await fetch(url);
		if (!res.ok || !res.body) return null;

		const file = await Deno.open(zipPath, { write: true });
		await res.body.pipeTo(file.writable);

		await unzipDir(zipPath, stagingDir);

		const entries = [];
		for await (const entry of Deno.readDir(stagingDir)) {
			entries.push(entry);
		}

		if (entries.length !== 1 || !entries[0].isDirectory) {
			throw new Error("Expected one root folder in the ZIP archive");
		}

		const extractedDir = join(stagingDir, entries[0].name);

		try {
			await Deno.remove(targetDir, { recursive: true });
		} catch (error) {
			if (!(error instanceof Deno.errors.NotFound)) throw error;
		}

		await Deno.rename(extractedDir, targetDir);
		return targetDir;
	} finally {
		await Deno.remove(zipPath).catch(() => {});
		await Deno.remove(stagingDir, { recursive: true }).catch(() => {});
	}
}

async function buildMetaBox(meta: MetaBox): Promise<boolean> {
	let ok = false;

	if (isDirectoryExist(meta.workDir)) {
		const requiredPaths: FileEntry[] = [
			{ path: "go.mod", type: "file" },
			{ path: "go.sum", type: "file" },
			{ path: "cmd/sing-box", type: "directory" },
		] as const;
		if (hasRequiredFiles(meta.workDir, requiredPaths)) {
			ok = true;
		}
	}

	if (!ok) {
		await Deno.remove(meta.workDir).catch((_) => {});
		const res = await prepareAsset(meta.workDir);
		if (!res) {
			return false;
		}
		meta.workDir = res;
	}
	/** */

	const goExe = "go";

	const version = await getOutput(
		goExe,
		["run", "github.com/sagernet/sing-box/cmd/internal/read_tag@latest"],
		meta.workDir,
		{ CGO_ENABLED: "0" },
	);

	const tags = (
		await Deno.readTextFile(
			join(meta.workDir, "release", "DEFAULT_BUILD_TAGS_OTHERS"),
		)
	).trim();
	/*
	const TAGS = [
		"with_gvisor",
		"with_wireguard",
		"with_v2ray_api",
		"with_clash_api",
		"with_quic",
		"with_grpc",
		"with_utls",
		"with_cloudflared",
	].join(",");
	*/

	const sharedLdfags = (
		await Deno.readTextFile(join(meta.workDir, "release", "LDFLAGS"))
	).trim();

	const ldflags =
		`-X 'github.com/sagernet/sing-box/constant.Version=${version}' ` +
		`${sharedLdfags} -s -w -buildid=`;

	await Deno.mkdir(dirname(meta.boxExe), { recursive: true });

	const result = await new Deno.Command(goExe, {
		args: [
			"build",
			"-v",
			"-trimpath",
			"-ldflags",
			ldflags,
			"-tags",
			tags,
			"-o",
			meta.boxExe,
			"./cmd/sing-box",
		],
		cwd: meta.workDir,
		env: { GOTOOLCHAIN: "local" },
		stdin: "null",
		stdout: "inherit",
		stderr: "inherit",
	}).output();

	return result.success;
}

export async function startBox(cwd: string) {
	// Prepare
	const meta = prepareSingBox();

	let singBoxFound = true;
	try {
		const singBoxStat = Deno.statSync(meta.boxExe);
		if (!singBoxStat || !singBoxStat.isFile) {
			singBoxFound = false;
		}
	} catch (err) {
		if (err instanceof Deno.errors.NotFound) {
			singBoxFound = false;
		} else {
			console.error(err);
			Deno.exit();
		}
	}

	if (!singBoxFound) {
		const ok = await buildMetaBox(meta);
		if (!ok) {
			Deno.exit();
		}
	}

	// Start
	type ConsoleType = "console" | "daemon";
	const termType: ConsoleType = "console" as ConsoleType;

	const args = ["run"];
	console.log(`Starting ${meta.boxExe} ...`);

	const cmdOpts: Deno.CommandOptions = {
		args: args,
		stdin: "null",
		stderr: "inherit",
		stdout: "inherit",
		cwd: cwd
	};
	if(termType === "daemon") {
		cmdOpts.stdin = "null";
		cmdOpts.stdout = "null";
		cmdOpts.stderr = "null";
	}

	const process = new Deno.Command(meta.boxExe, cmdOpts).spawn();
	if(termType === "daemon") {
		process.unref();
	} else {
		await process.output();
	}
}
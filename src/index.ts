import { join } from "@std/path/join";
import { BuildOptions } from "./config.ts";
import { appendProperty, getProperty } from "./property.ts";
import { buildRoute, RouteAcceptor } from "./routes.ts";
import {
	extendObjectFromDirectory,
	isJsonFile,
	isJsonObject,
	JsonObject,
	loadArrayDirectory,
	loadFile,
	safeLoadJsonObject,
	sortedEntries,
	withoutJsonExtension,
} from "./utils.ts";

export function buildConfig(options: BuildOptions, acceptor: RouteAcceptor) {
	const config: JsonObject = safeLoadJsonObject(options.inputFile);

	const rootEntries = sortedEntries(options.configDir);
	const rootJsonStems = new Set(
		rootEntries
			.filter(isJsonFile)
			.map((entry) => withoutJsonExtension(entry.name)),
	);

	// First, we load the files: they can be base objects
	// for folders with the same name.
	for (const entry of rootEntries) {
		if (isJsonFile(entry)) {
			const key = withoutJsonExtension(entry.name);
			config[key] = loadFile(join(options.configDir, entry.name));
		}
	}

	for (const entry of rootEntries) {
		if (!entry.isDirectory) continue;

		const dir = join(options.configDir, entry.name);

		if (rootJsonStems.has(entry.name)) {
			// configs/dns.json + configs/dns/
			const base = config[entry.name];

			if (!isJsonObject(base)) {
				throw new Error(
					`"${entry.name}/" is a complement to "${entry.name}.json", ` +
						`but it doesn't contain a JSON object`,
				);
			}

			extendObjectFromDirectory(base, dir);
		} else {
			// configs/rules/*.json → config.rules = [...]
			config[entry.name] = loadArrayDirectory(dir);
		}
	}
	const propKey = `outbounds`;
	let outbound = getProperty(config, propKey);
	if (!isJsonObject(outbound)) {
		outbound = {
			tag: options.directOutbound,
			type: "direct",
		} as JsonObject;
		appendProperty(config, propKey, outbound);
	}
	if (options.l3DirectOutbound) {
		outbound = {
			tag: options.l3DirectOutbound,
			type: "bridge",
		} as JsonObject;
		appendProperty(config, propKey, outbound);
	}
	buildRoute(options, config, acceptor);

	console.log(`Building ${options.outputFile} ...`);
	Deno.mkdirSync(options.workDir, { recursive: true });
	Deno.writeTextFileSync(
		options.outputFile,
		JSON.stringify(config, null, "\t"),
	);
}

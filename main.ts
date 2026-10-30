import { join } from "@std/path/join";
import { BuildOptions } from "./src/config.ts";
import { convertWireGuardToSingBox } from "./src/convert.ts";
import { buildConfig } from "./src/index.ts";
import { startBox } from "./src/launcher.ts";
import { Route, RouteAcceptor } from "./src/routes.ts";

const inDir = "indir";
const profileDir = "profile";
const workdirPath = "workdir";

const configDir = join(inDir, "config");
const rulesSearchDirs = ["rules", join(inDir, "rules")];
const routeDir = join(inDir, "route");
const inputFile = join(inDir, "config.json");

const outputFile = join(workdirPath, "config.json");

let l3BridgeEnabled: boolean = false;

async function main() {
	l3BridgeEnabled = Deno.build.os === "windows";

	const options: BuildOptions = {
		configDir,
		rulesSearchDirs: rulesSearchDirs,
		routeDir: routeDir,
		inputFile,
		workDir: workdirPath,
		outputFile,
		proxyOutbound: "proxy",
		directOutbound: "direct",
		dnsDirectServer: "dns-direct",
	};
	if (l3BridgeEnabled) {
		options.l3DirectOutbound = "l3-direct";
	}

	const builtinOutbounds = ["direct", "block"];
	const overrideRoutes: Record<string, string> = {
		// "geo-fi": "WARPw26312.conf",
		// "geo-nl": "WARPw46075.conf",
		// "geo-de": "WARPw04621.conf",
		// "geo-pl": "WARPw46972.conf",
		// "geo-de-alt": "AWGw35194.conf",
		// "proxy": "WARPw05841.conf"
	};

	buildConfig(options, ((entry, config) => {
		if (builtinOutbounds.includes(entry)) {
			return new Route("route", entry);
		}

		let fileName = overrideRoutes[entry];
		if (!fileName || fileName.trim().length === 0) {
			fileName = `${entry}.conf`;
		}

		if (
			!convertWireGuardToSingBox(
				entry,
				join(profileDir, fileName),
				config,
			)
		) {
			return null;
		}
		return new Route("route", entry);
	}) as RouteAcceptor);
	await startBox(workdirPath);
}
await main();

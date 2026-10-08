import { join } from "@std/path/join";
import { RouteAcceptor, buildConfig, BuildOptions, fillRoute, Route } from "./src/index.ts";
import { convertWireGuardToSingBox } from "./src/convert.ts";
import { startBox } from "./src/launcher.ts";

const inDir = "indir";
const profileDir = "profile";

const configDir = join(inDir, "config");
const rulesDir = join(inDir, "rules");
const routeDir = join(inDir, "route");
const inputFile = join(inDir, "config.json");

const workdirPath = "workdir";
const outputFile = join(workdirPath, "config.json");

let l3BridgeEnabled: boolean = false;

async function main() {
	l3BridgeEnabled = Deno.build.os === "windows";

	const options: BuildOptions = {
		configDir,
		rulesDir: rulesDir,
		routeDir: routeDir,
		inputFile,
		workDir: workdirPath,
		outputFile,
		directOutbound: "direct",
		dnsDirectServer: "dns-direct"
	};
	if(l3BridgeEnabled) {
		options.l3DirectOutbound = "l3-direct";
	}

	buildConfig(options, ((entry, rules, config) => {
		const route = {
			action: "route",
			outbound: entry
		} as Route;
		switch(entry) {
			// case "geo-fi":
			// 	convertWireGuardToSingBox(entry, join(profileDir, "WARPw26312.conf"), config);
			// 	break;
			// case "geo-nl":
			// 	convertWireGuardToSingBox(entry, join(profileDir, "WARPw46075.conf"), config);
			// 	break;
			// case "geo-de":
			// 	convertWireGuardToSingBox(entry, join(profileDir, "WARPw04621.conf"), config);
			// 	break;
			// case "geo-de":
			// 	convertWireGuardToSingBox(entry, join(profileDir, "AWGw35194.conf"), config);
			// 	break;
			case "proxy":
				convertWireGuardToSingBox("proxy", join(profileDir, "proxy.conf"), config);
				break;
		}
		fillRoute(route, rules);
		return route;
	}) as RouteAcceptor);
	await startBox(workdirPath);
}
await main();

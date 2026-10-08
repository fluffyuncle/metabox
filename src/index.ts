import { join } from "@std/path/join";
import { resolve } from "@std/path/resolve";
import { appendProperty, getProperty, setProperty } from "./property.ts";
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

export type RuleType =
	| "include"
	| "domain"
	| "ruleset"
	| "full"
	| "regexp"
	| "keyword"
	| "cidr"
	| "ip"
	| "processPath";

export interface Rule {
	type: RuleType;
	categories: string[];
	value: string;
}

export interface Route {
	action: string;
	outbound?: string;
	preferred_by?: string[];
	domain?: string[];
	domain_keyword?: string[];
	domain_regex?: string[];
	domain_suffix?: string[];
	rule_set?: string[];
	ip_cidr?: string[];
	server?: string;
}

export type RouteAcceptor = (
	entry: string,
	rules: Rule[],
	config: JsonObject,
) => Route;

export type RulePredicate = (rule: Rule) => boolean;

export interface BuildOptions {
	inputFile: string;
	configDir: string;
	rulesDir: string;
	routeDir: string;
	workDir: string;
	outputFile: string;

	directOutbound: string;
	l3DirectOutbound?: string;
	dnsDirectServer?: string;
}

export function fillRoute(route: Route, rule: Rule | Rule[]) {
	if (Array.isArray(rule)) {
		rule.forEach((r) => fillRoute(route, r));
		return;
	}

	switch (rule.type) {
		case "domain": {
			if (!route.domain_suffix) route.domain_suffix = [];
			route.domain_suffix.push(rule.value);
			break;
		}
		case "full": {
			if (!route.domain) route.domain = [];
			route.domain.push(rule.value);
			break;
		}
		case "keyword": {
			if (!route.domain_keyword) route.domain_keyword = [];
			route.domain_keyword.push(rule.value);
			break;
		}
		case "regexp": {
			if (!route.domain_regex) route.domain_regex = [];
			route.domain_regex.push(rule.value);
			break;
		}
		case "ruleset": {
			if (!route.rule_set) route.rule_set = [];
			route.rule_set.push(rule.value);
			break;
		}
		case "ip": {
			const isIPv6 = rule.value.includes(":");
			if (!route.ip_cidr) route.ip_cidr = [];
			let ip = rule.value;
			if (ip.includes("/")) {
				console.warn(
					`Incorrect syntax for "${ip}". For example: "ip:1.1.1.1".`,
				);
				const idxSlash = ip.indexOf("/");
				ip = ip.substring(0, idxSlash);
			}
			route.ip_cidr.push(isIPv6 ? `${ip}/128` : `${ip}/32`);
			break;
		}
		case "cidr": {
			if (!route.ip_cidr) route.ip_cidr = [];
			const cidr = rule.value;
			if (!cidr.includes("/")) {
				console.error(
					`Incorrect syntax for "${cidr}". For example: "cidr:1.1.1.1/8".`,
				);
			}
			route.ip_cidr.push(cidr);
			break;
		}
	}
}

export function buildRule(
	path: string,
	routeDir: string,
	includedFiles: string[] = [],
): Rule[] {
	if (includedFiles.includes(path)) return [];
	includedFiles.push(path);

	const arr: Rule[] = [];

	const lines = Deno.readTextFileSync(path).split("\n");
	for (let line of lines) {
		if (line.length === 0) continue;

		const idxCom = line.indexOf("#");
		if (idxCom !== -1) {
			line = line.substring(0, idxCom);
		}
		line = line.trim();

		if (line.length === 0) continue;
		/*             TRUNCATE             */

		let type: RuleType = "domain";
		const categories: string[] = [];
		let value: string = "";

		const idxColon = line.indexOf(":");
		let text: string = line;

		if (idxColon !== -1) {
			type = line.substring(0, idxColon) as RuleType;
			text = line.substring(idxColon + 1);
		}

		const tokens = text.trim().split(/\s+/);
		value = tokens.shift() ?? "";

		for (const token of tokens) {
			if (token.startsWith("@") && token.length > 1) {
				categories.push(token.slice(1));
			} else {
				console.log("ERR:", line);
			}
		}

		if (type === "include") {
			const includePath = resolve(routeDir, value);
			arr.push(...buildRule(includePath, routeDir, includedFiles));
			continue;
		}

		const rule = {
			type,
			categories,
			value,
		} as Rule;
		arr.push(rule);
	}

	return arr;
}

export function buildRoute(
	options: BuildOptions,
	config: JsonObject,
	acceptor: RouteAcceptor,
	predicate: RulePredicate = (_) => {
		return true;
	},
) {
	// let l3DirectRoute: Route | undefined;
	// if (options.l3DirectOutbound) {
	// 	l3DirectRoute = {
	// 		action: "route",
	// 		outbound: options.l3DirectOutbound,
	// 		preferred_by: [options.l3DirectOutbound],
	// 	};
	// }

	// let directRoute: Route;

	// for (const rule of rules) {
	// 	fillRoute(directRoute, rule);
	// 	if (l3DirectRoute) {
	// 		fillRoute(l3DirectRoute, rule);
	// 	}

	// let dnsRoute: Route | undefined;
	// if (options.dnsDirectServer) {
	// 	dnsRoute = {
	// 		action: "route",
	// 		server: options.dnsDirectServer,
	// 	};
	// }

	// 	if (dnsRoute) {
	// 		switch (rule.type) {
	// 			case "full":
	// 			case "domain":
	// 			case "regexp":
	// 			case "keyword":
	// 				fillRoute(dnsRoute, rule);
	// 				break;
	// 		}
	// 	}
	// }
	// if (l3DirectRoute) {
	// 	appendProperty(config, "route.rules", l3DirectRoute);
	// }

	for (const entry of Deno.readDirSync(options.routeDir)) {
		if (entry.isDirectory) continue;
		if (entry.name === options?.l3DirectOutbound) continue;

		console.log(`Building route ${entry.name} ...`);
		const route = acceptor(
			entry.name,
			buildRule(
				join(options.routeDir, entry.name),
				options.rulesDir,
			).filter((value) => {
				return predicate(value);
			}),
			config,
		);
		appendProperty(config, "route.rules", route);

		if (entry.name === options.directOutbound && options.l3DirectOutbound) {
			const l3DirectRoute = structuredClone(route);
			l3DirectRoute.outbound = options.l3DirectOutbound;
			l3DirectRoute.preferred_by = [options.l3DirectOutbound];
			appendProperty(config, "route.rules", l3DirectRoute);
		}
	}

	// if (dnsRoute) {
	// 	appendProperty(config, "dns.rules", dnsRoute);
	// }
}

export function buildConfig(options: BuildOptions, acceptor: RouteAcceptor) {
	const config: JsonObject = safeLoadJsonObject(options.inputFile);
	if (options.l3DirectOutbound) {
		const propKey = `outbounds`;
		let outbound = getProperty(config, propKey);
		if (!isJsonObject(outbound)) {
			outbound = {
				tag: options.l3DirectOutbound,
				type: "bridge",
			} as JsonObject;
			appendProperty(config, propKey, outbound);
		}
	}
	{
		const propKey = `outbounds`;
		let outbound = getProperty(config, propKey);
		if (!isJsonObject(outbound)) {
			outbound = {
				tag: options.directOutbound,
				type: "direct",
			} as JsonObject;
			appendProperty(config, propKey, outbound);
		}
	}

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
	buildRoute(options, config, acceptor);

	console.log(`Building ${options.outputFile} ...`);
	Deno.mkdirSync(options.workDir, { recursive: true });
	Deno.writeTextFileSync(
		options.outputFile,
		JSON.stringify(config, null, "\t"),
	);
}

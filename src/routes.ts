import { join } from "@std/path/join";
import { appendProperty, setProperty } from "./property.ts";
import { buildRule, Rule, RuleConsumer, RuleExpander, TextSource } from "./rules.ts";
import { JsonObject } from "./utils.ts";
import { BuildOptions } from "./config.ts";

export type RouteAcceptor = (entry: string, config: JsonObject) => Route | null;

export class Route {
	constructor(
		public action: string,
		public outbound?: string,
		public preferred_by?: string[],
		public domain?: string[],
		public domain_keyword?: string[],
		public domain_regex?: string[],
		public domain_suffix?: string[],
		public rule_set?: string[],
		public ip_cidr?: string[],
		public server?: string,
	) {}

	apply(rule: Rule) {
		switch (rule.type) {
			case "domain": {
				if (!this.domain_suffix) this.domain_suffix = [];
				this.domain_suffix.push(rule.value);
				break;
			}
			case "full": {
				if (!this.domain) this.domain = [];
				this.domain.push(rule.value);
				break;
			}
			case "keyword": {
				if (!this.domain_keyword) this.domain_keyword = [];
				this.domain_keyword.push(rule.value);
				break;
			}
			case "regexp": {
				if (!this.domain_regex) this.domain_regex = [];
				this.domain_regex.push(rule.value);
				break;
			}
			case "ruleset": {
				if (!this.rule_set) this.rule_set = [];
				this.rule_set.push(rule.value);
				break;
			}
			case "ip": {
				const isIPv6 = rule.value.includes(":");
				if (!this.ip_cidr) this.ip_cidr = [];
				let ip = rule.value;
				if (ip.includes("/")) {
					console.warn(
						`Incorrect syntax for "${ip}". For example: "ip:1.1.1.1".`,
					);
					const idxSlash = ip.indexOf("/");
					ip = ip.substring(0, idxSlash);
				}
				this.ip_cidr.push(isIPv6 ? `${ip}/128` : `${ip}/32`);
				break;
			}
			case "cidr": {
				if (!this.ip_cidr) this.ip_cidr = [];
				const cidr = rule.value;
				if (!cidr.includes("/")) {
					console.error(
						`Incorrect syntax for "${cidr}". For example: "cidr:1.1.1.1/8".`,
					);
				}
				this.ip_cidr.push(cidr);
				break;
			}
		}
	}
}

export function buildRoute(
	options: BuildOptions,
	config: JsonObject,
	acceptor: RouteAcceptor,
	predicate: RuleConsumer = new (class extends RuleConsumer {
		override accept(_rule: Rule, _source: TextSource): boolean {
			return true;
		}
	})(),
) {
	setProperty(config, "route.final", options.proxyOutbound);

	const expander = new RuleExpander();

	for (const entry of Deno.readDirSync(options.routeDir)) {
		if (entry.isDirectory) continue;
		if (entry.name === options?.l3DirectOutbound) continue;
		const route = acceptor(entry.name, config);
		
		let log = `Building route ${entry.name} ... `;
		if(route !== null) {
			log += '<Accepted>';
		} else {
			log += '<Skipped>';
		}
		console.log(log);

		if (route === null) continue;

		if (!(route instanceof Route)) {
			throw new Error("Route is not instanced rights");
		}

		const routeFilePath = join(options.routeDir, entry.name);

		const routeConsumer = new (class extends RuleConsumer {
			override accept(rule: Rule, source: TextSource): boolean {
				if (rule.type === "include") {
					expander.visit(
						rule.value, 
						this, 
						options.rulesSearchDirs, 
						rule.attrs, 
						[routeFilePath]
					);
					return true;
				}

				const enabled = predicate.accept(rule, source);
				// console.log(
				// 	`${source.toString()} for rule "${rule.toString()}"`,
				// );
				
				if (enabled) {
					route.apply(rule);
				}
				return enabled;
			}
		})();

		buildRule(routeFilePath, routeConsumer);
		if (
			!(
				route.domain ||
				route.domain_suffix ||
				route.domain_keyword ||
				route.domain_regex ||
				route.ip_cidr ||
				route.rule_set
			)
		) {
			continue;
		}

		if (entry.name === options.directOutbound && options.l3DirectOutbound) {
			const l3DirectRoute = structuredClone(route);
			l3DirectRoute.action = "route";
			l3DirectRoute.outbound = options.l3DirectOutbound;
			l3DirectRoute.preferred_by = [options.l3DirectOutbound];
			appendProperty(config, "route.rules", l3DirectRoute);
		}

		appendProperty(config, "route.rules", route);
	}
}
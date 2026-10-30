import { resolve } from "@std/path/resolve";

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

export class Rule {
	constructor(
		public readonly type: RuleType,
		public readonly value: string,
		public readonly attrs: string[] = [],
		public readonly affiliations: string[] = [],
	) {}

	toString(): string {
		return `${this.type}:${this.value}${this.attrs.join(' @')}${this.affiliations.join(' &')}`;
	}
}

function matchesInclude(rule: Rule, selectors: string[]): boolean {
	return selectors.every((selector) => {
		if (selector.startsWith("-")) {
			const excludedAttr = selector.slice(1);
			return (
				excludedAttr.length > 0 && !rule.attrs.includes(excludedAttr)
			);
		}

		return rule.attrs.includes(selector);
	});
}

export class TextSource {
	constructor(
		readonly file: string,
		readonly line: number,
	) {}

	toString() {
		return `${this.file}:${this.line}`;
	}
}

export abstract class RuleConsumer {
	abstract accept(rule: Rule, source: TextSource): boolean;

	with(other: RuleConsumer): RuleConsumer {
		return new MergeRuleConsumer(this, other);
	}
}

class MergeRuleConsumer extends RuleConsumer {
	private readonly consumers: readonly RuleConsumer[];

	constructor(...consumers: RuleConsumer[]) {
		super();
		this.consumers = consumers;
	}

	override accept(rule: Rule, source: TextSource): boolean {
		let ok = true;
		for (const consumer of this.consumers) {
			if (!consumer.accept(rule, source)) {
				ok = false;
				break;
			}
		}
		return ok;
	}
}

export class RuleExpander {
	visit(
		name: string,
		consumer: RuleConsumer,
		searchDirs: readonly string[],
		attrs: string[] = [],
		includeStack: string[] = [],
	) {
		for (const searchDir of searchDirs) {
			const includePath = resolve(searchDir, name);

			if (includeStack.includes(includePath)) {
				throw new Error(
					`Circular include: ${[...includeStack, includePath].join(" -> ")}`,
				);
			}

			try {
				const stat = Deno.statSync(includePath);
				if (!stat.isFile) continue;

				const nextIncludeStack = [...includeStack, includePath];

				buildRule(includePath, new class extends RuleConsumer {
					constructor(private expander: RuleExpander) {
						super();
					}

					override accept(rule: Rule, source: TextSource): boolean {
						if (rule.type === "include") {
							if (matchesInclude(rule, attrs)) {
								this.expander.visit(
									rule.value,
									consumer,
									searchDirs,
									rule.attrs,
									nextIncludeStack,
								);
								return true;
							}
							return false;
						}

						return consumer.accept(rule, source);
					}
				}(this));
				break;
			} catch (err) {
				if (!(err instanceof Deno.errors.NotFound)) throw err;
			}
		}
	}
}

export function buildRule(
	path: string,
	consumer: RuleConsumer,
	defaultRuleType: RuleType = "domain",
) {
	const lines = Deno.readTextFileSync(path).split("\n");
	let lineNumber = 0;
	for (let line of lines) {
		lineNumber++;
		if (line.length === 0) continue;

		const idxCom = line.indexOf("#");
		if (idxCom !== -1) {
			line = line.substring(0, idxCom);
		}
		line = line.trim();

		if (line.length === 0) continue;

		let type: RuleType = defaultRuleType;
		let value: string = "";
		const attrs: string[] = [];
		const affiliations: string[] = [];

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
				attrs.push(token.slice(1));
			} else if (token.startsWith("&") && token.length > 1) {
				affiliations.push(token.slice(1));
			} else {
				console.log("ERR:", line);
			}
		}

		consumer.accept(
			new Rule(type, value, attrs, affiliations),
			new TextSource(path, lineNumber),
		);
	}
}

import { appendProperty } from "./property.ts";
import { JsonObject } from "./utils.ts";

// https://stackoverflow.com/a/69878219/24857409
export const splitCaps = (string: string) =>
	string
		.replace(/([a-z])([A-Z]+)/g, (_, s1, s2) => s1 + " " + s2)
		.replace(
			/([A-Z])([A-Z]+)([^a-zA-Z0-9]*)$/,
			(_, s1, s2, s3) => s1 + s2.toLowerCase() + s3,
		)
		.replace(
			/([A-Z]+)([A-Z][a-z])/g,
			(_, s1, s2) => s1.toLowerCase() + " " + s2,
		);
export const snakeCase = (string: string) =>
	splitCaps(string)
		.replace(/\W+/g, " ")
		.split(/ |\B(?=[A-Z])/)
		.map((word) => word.toLowerCase())
		.join("_"); //;

type IniFlag = "optional" | "required";

interface IniSection {
	flag: IniFlag;
	version?: string;
}

function IniSection(flag: IniFlag, version?: string): IniSection {
	return {
		flag: flag,
		version: version,
	} as IniSection;
}

export const WireGuardInterface: Record<string, IniSection> = {
	PrivateKey: IniSection("required"),
	Address: IniSection("required"),
	ListenPort: IniSection("optional"),
	DNS: IniSection("optional"),
	MTU: IniSection("optional"),
	Table: IniSection("optional"),
	PreUp: IniSection("optional"),
	PostUp: IniSection("optional"),
	PreDown: IniSection("optional"),
	PostDown: IniSection("optional"),
	SaveConfig: IniSection("optional"),
};

export const WireGuardPeer: Record<string, IniSection> = {
	PublicKey: IniSection("required"),
	PresharedKey: IniSection("optional"),
	AllowedIPs: IniSection("required"),
	Endpoint: IniSection("optional"),
	PersistentKeepalive: IniSection("optional"),
};

const AmneziaWireGuardInterface: Record<string, IniSection> = {
	Jc: IniSection("required", "1.0"),
	Jmin: IniSection("required", "1.0"),
	Jmax: IniSection("required", "1.0"),
	S1: IniSection("required", "1.0"),
	S2: IniSection("required", "1.0"),
	H1: IniSection("required", "1.0"),
	H2: IniSection("required", "1.0"),
	H3: IniSection("required", "1.0"),
	H4: IniSection("required", "1.0"),
	S3: IniSection("optional", "2.0"),
	S4: IniSection("optional", "2.0"),
	I1: IniSection("required", "2.0"),
	I2: IniSection("optional", "2.0"),
	I3: IniSection("optional", "2.0"),
	I4: IniSection("optional", "2.0"),
	I5: IniSection("optional", "2.0"),
	HeaderProtectionKey: IniSection("required", "3.0"),
	ContentPaddingAddition: IniSection("optional", "3.0"),
	RekeyAfterTime: IniSection("optional", "3.0"),
	RekeyTimeout: IniSection("optional", "3.0"),
	RejectAfterTime: IniSection("optional", "3.0"),
	KeepaliveTimeout: IniSection("optional", "3.0"),
	MaxHandshakeAttempts: IniSection("optional", "3.0"),
	RandomTrailers: IniSection("optional", "3.1"),
	DisableCookies: IniSection("optional", "3.1"),
};

function formatAmneziaValueForThrone(key: string, value: string) {
	if (value.toLowerCase() === "on" || value.toLowerCase() === "true") return true;
	if (value.toLowerCase() === "off" || value.toLowerCase() === "false") return false;

	const numericFields = ["jc", "jmin", "jmax", "s1", "s2", "s3", "s4"];
	if (numericFields.includes(key)) {
		return Number.parseInt(value, 10);
	}
	
	return value;
}

export function convertWireGuardToSingBox(tag: string, inputFile: string, config: JsonObject) {
	const Interface: Record<string, string> = {};
	const Peer: Record<string, string>[] = [];

	const content = Deno.readTextFileSync(inputFile);
	const lines = content.split("\n");
	let section = "";

	for (let line of lines) {
		const idxSharp = line.indexOf("#");
		if (idxSharp !== -1) {
			line = line.substring(0, idxSharp);
		}
		line = line.trim();
		if (line.length === 0) continue;

		const idxLB = line.indexOf("[");

		if (idxLB !== -1) {
			const idxRB = line.indexOf("]", idxLB);
			if (idxLB === -1) {
				console.error("Couldn't parse line:", line);
				break;
			}
			section = line.substring(idxLB + 1, idxRB);
			if (section === "Peer") {
				Peer.push({});
			}
			continue;
		}

		if (section === "") {
			console.warn("Skipping line:", line);
			continue;
		}

		const idxEq = line.indexOf('=');

		const key = line.substring(0, idxEq).trimEnd();
		const value = line.substring(idxEq + 1).trimStart();

		if (section === "Interface") {
			Interface[key] = value;
		} else if (section === "Peer") {
			Peer[Peer.length - 1][key] = value;
		}
	}

	/*   BUILDING    */
	const outbound: JsonObject = {
		type: "wireguard",
		tag: tag,
	};

	if (Interface["PrivateKey"]) outbound["private_key"] = Interface["PrivateKey"];
	if (Interface["MTU"]) outbound["mtu"] = Number.parseInt(Interface["MTU"], 10);

	if (Interface["Address"]) {
		outbound["address"] = Interface["Address"]
			.split(",")
			.map(i => i.trim())
			.map(ip => {
				if(ip.includes("/")) return ip;

				if(ip.includes(":")) return `${ip}/128`;
				return `${ip}/32`;
			});
	}

	const amneziaWgBlock: JsonObject = {};

	for (const [key, value] of Object.entries(Interface)) {
		if (AmneziaWireGuardInterface[key]) {
			const targetKey = snakeCase(key);
			amneziaWgBlock[targetKey] = formatAmneziaValueForThrone(targetKey, value);
		}
	}

	if (Object.keys(amneziaWgBlock).length > 0) {
		outbound["amnezia_wg"] = amneziaWgBlock;
	}

	if (Peer.length > 0) {
		outbound["peers"] = Peer.map(peer => {
			const peerObj: JsonObject = {};
			
			if (peer["PublicKey"]) peerObj["public_key"] = peer["PublicKey"];
			if (peer["PresharedKey"]) peerObj["pre_shared_key"] = peer["PresharedKey"];
			
			if (peer["AllowedIPs"]) {
				peerObj["allowed_ips"] = peer["AllowedIPs"].split(",").map(ip => ip.trim());
			}
			
			if (peer["Endpoint"]) {
				const lastColon = peer["Endpoint"].lastIndexOf(":");
				if (lastColon !== -1) {
					let host = peer["Endpoint"].substring(0, lastColon);
					const port = Number.parseInt(peer["Endpoint"].substring(lastColon + 1), 10);
					
					if (host.startsWith("[") && host.endsWith("]")) {
						host = host.slice(1, -1);
					}
					peerObj["address"] = host;
					peerObj["port"] = port;
				} else {
					peerObj["address"] = peer["Endpoint"];
				}
			}
			
			if (peer["PersistentKeepalive"]) {
				peerObj["persistent_keepalive_interval"] = Number.parseInt(peer["PersistentKeepalive"], 10);
			}
			
			return peerObj;
		});
	}

	appendProperty(config, "endpoints", outbound);
}

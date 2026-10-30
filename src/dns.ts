export class DnsServer {
	constructor(public readonly tag: string) {}
}

export class LegacyDnsServer extends DnsServer {

}

export class LocalDnsServer extends DnsServer {
	constructor(
		public readonly prefers_go?: boolean | undefined,
		public readonly neighbor_domain?: string[] | undefined
	) {
		super("local")
	}
}

export interface DialFields {
// 	public readonly detour?: string,
// 	public readonly bind_interface?: string,
// 	public readonly inet4_bind_address?: string,
// 	public readonly inet6_bind_address?: string,
// 	public readonly bind_address_no_port?: boolean,
// 	public readonly routing_mark?: number,
// 	public readonly reuse_addr?: boolean,
// 	public readonly netns?: string,
// 	public readonly connect_timeout?: string,
// 	public readonly tcp_fast_open?: boolean,
// 	public readonly tcp_multi_path?: boolean,
// 	public readonly disable_tcp_keep_alive?: boolean,
// 	public readonly tcp_keep_alive?: string,
// 	public readonly tcp_keep_alive_interval?: string,
// 	public readonly udp_fragment?: boolean,

//   domain_resolver?: string | object, // or {}
//   network_strategy?: string,
//   network_type?: [],
//   fallback_network_type?: [],
//   fallback_delay?: string,

//   // Deprecated
//   domain_strategy?: string
}

export class RemoteDnsServer extends DnsServer implements DialFields {
	public readonly type: string;
	public readonly server: string;
	public readonly server_port: number;

	constructor(
		schema: string,
		address: string,
		port: number,
	) {
		super("");
		this.type = schema;
		this.server = address;
		this.server_port = port;
	}
}

export class TCPDnsServer extends RemoteDnsServer {
	constructor(address: string, port: number = 53) {
		super("tcp", address, port);
	}
}

export class UDPDnsServer extends RemoteDnsServer {
	constructor(address: string, port: number = 53) {
		super("udp", address, port);
	}
}

export class TLSDnsServer extends RemoteDnsServer {
	constructor(address: string, port: number = 853) {
		super("tls", address, port);
	}
}

export class QUICDnsServer extends RemoteDnsServer {
	constructor(address: string, port: number = 853) {
		super("quic", address, port);
	}
}

export class HttpsDnsServer extends RemoteDnsServer {
	constructor(
		address: string,
		port: number = 443,
		public readonly path: string = "/dns-query",
	) {
		super("https", address, port);
	}
}

export class H3DnsServer extends RemoteDnsServer {
	constructor(
		address: string,
		port: number = 443,
		public readonly path: string = "/dns-query",
	) {
		super("h3", address, port);
	}
}

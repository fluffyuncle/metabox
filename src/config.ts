export interface BuildOptions {
	inputFile: string;
	configDir: string;
	rulesSearchDirs: string[];
	routeDir: string;
	workDir: string;
	outputFile: string;

	proxyOutbound: string;
	directOutbound: string;
	l3DirectOutbound?: string;
	dnsDirectServer?: string;
}
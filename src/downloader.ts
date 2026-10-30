import { basename } from "@std/path/basename";
import { dirname } from "@std/path/dirname";
import {
	ResultError,
	ResultSuccess,
	StackResultError,
	type Result,
} from "./result.ts";

export interface Downloadable {
	url: string;
}

export class FileDownloadable implements Downloadable {
	constructor(
		readonly url: string,
		readonly path: string,
	) {}
}

export class ShaDownloadable extends FileDownloadable {
	constructor(
		url: string,
		path: string,
		readonly sha: string,
	) {
		super(url, path);
	}
}

export function createProgressTracker(total: number, message: string) {
	const encoder = new TextEncoder();

	let received = 0;
	let lastReport = 0;

	const startTime = Date.now();
	let lastSpeedTime = startTime;
	let lastSpeedReceived = 0;
	let currentSpeed = 0;

	const C = {
		reset: "\x1b[0m",
		bold: "\x1b[1m",
		cyan: "\x1b[36m",
		green: "\x1b[32m",
		yellow: "\x1b[33m",
		gray: "\x1b[90m",
	};

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
		if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
		return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
	}

	function formatETA(bytesRemaining: number): string {
		if (currentSpeed <= 0) return "--:--";
		const seconds = Math.round(bytesRemaining / currentSpeed);
		if (seconds >= 3600) return "1h+";
		const mins = Math.floor(seconds / 60)
			.toString()
			.padStart(2, "0");
		const secs = (seconds % 60).toString().padStart(2, "0");
		return `${mins}:${secs}`;
	}

	function getSmoothBar(width: number, percent: number): string {
		const blocks = ["░", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
		const exactFilled = (percent / 100) * width;
		const fullBlocksCount = Math.floor(exactFilled);
		const remainder = exactFilled - fullBlocksCount;
		const blockIndex = Math.floor(remainder * 8);

		const fullPart = "█".repeat(fullBlocksCount);
		const partialPart = fullBlocksCount < width ? blocks[blockIndex] : "";
		const emptyPart = "░".repeat(
			Math.max(0, width - fullBlocksCount - (partialPart ? 1 : 0)),
		);

		return `${C.green}${fullPart}${partialPart}${C.gray}${emptyPart}${C.reset}`;
	}

	function render(final = false): void {
		let line: string;

		if (total > 0) {
			const percent = Math.min(100, (received / total) * 100);
			const percentInt = Math.floor(percent);
			const bar = getSmoothBar(25, percent);
			const eta = final ? "00:00" : formatETA(total - received);
			const speedStr = final ? "done" : `${formatBytes(currentSpeed)}/s`;

			line =
				`${C.bold}${C.cyan}${message}${C.reset} ` +
				`[${bar}] ` +
				`${C.bold}${percentInt.toString().padStart(3)}%${C.reset} | ` +
				`${formatBytes(received)}/${formatBytes(total)} | ` +
				`${C.yellow}${speedStr.padStart(11)}${C.reset} | ` +
				`ETA: ${eta}`;
		} else {
			const speedStr = `${formatBytes(currentSpeed)}/s`;
			line = `${C.bold}${C.cyan}${message}${C.reset} | ${formatBytes(received)} | ${C.yellow}${speedStr}${C.reset}`;
		}

		const outputLine = `\r\x1b[2K${line}${final ? "\n" : ""}`;
		Deno.stderr.writeSync(encoder.encode(outputLine));
	}

	return new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			received += chunk.byteLength;
			const now = Date.now();

			if (now - lastSpeedTime >= 400) {
				const timePassed = (now - lastSpeedTime) / 1000;
				currentSpeed = (received - lastSpeedReceived) / timePassed;
				lastSpeedTime = now;
				lastSpeedReceived = received;
			}

			if (now - lastReport >= 80) {
				lastReport = now;
				render();
			}

			controller.enqueue(chunk);
		},

		flush() {
			const totalTime = (Date.now() - startTime) / 1000;
			currentSpeed = totalTime > 0 ? received / totalTime : 0;
			render(true);
		},
	});
}

function toShortName(name: string, limit: number = 30) {
	name = basename(name);
	return name.length > limit
			? name.slice(0, limit - 3) + "..."
			: name.padEnd(limit);
}

export async function downloadFile(urlStr: string, fileName: string, displayName: string = toShortName(basename(urlStr))) {
	await Deno.mkdir(dirname(fileName), {
		recursive: true,
	}).catch(() => {
		// empty
	});

	const file = await Deno.open(fileName, {
		write: true,
		create: true,
		truncate: true,
	});

	const res = await downloadToStream(urlStr, displayName, file.writable);
	return res;
}

export async function downloadToStream(
	urlStr: string,
	msg: string,
	targetStream: WritableStream<Uint8Array>,
): Promise<Result<unknown>> {
	const url = new URL(urlStr);
	const response = await fetch(url);

	if (!response.ok || response.body === null) {
		return new ResultError(
			`Failed to download file: HTTP ${response.status} ${response.statusText}`,
		);
	}
	const total = Number(response.headers.get("content-length") ?? 0);

	try {
		await response.body
			.pipeThrough(createProgressTracker(total, msg))
			.pipeTo(targetStream);
		return new ResultSuccess(null);
	} catch (error) {
		return new StackResultError(error);
	}
}

export async function downloadToMemory(
	urlStr: string,
	msg: string,
): Promise<Result<Uint8Array>> {
	const chunks: Uint8Array[] = [];

	const memoryStream = new WritableStream<Uint8Array>({
		write(chunk) {
			chunks.push(chunk);
		},
	});

	const result = await downloadToStream(urlStr, msg, memoryStream);

	if (result instanceof ResultError) {
		return result;
	}

	const totalLength = chunks.reduce(
		(acc, chunk) => acc + chunk.byteLength,
		0,
	);
	const fileBytes = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		fileBytes.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return new ResultSuccess(fileBytes);
}

export async function downloadToString(
	urlStr: string,
	msg: string,
): Promise<Result<string>> {
	const res = await downloadToMemory(urlStr, msg);
	if (!res.ok) return res;
	return new ResultSuccess(new TextDecoder().decode(res.data));
}

export async function downloadIfNotExist(
	downloadable: FileDownloadable,
	displayName: string = downloadable.path,
	expiresAfter?: number,
): Promise<boolean> {
	const filePath = downloadable.path;
	try {
		const stat = await Deno.stat(filePath);
		if (stat.isFile) {
			if (expiresAfter !== undefined) {
				const nowTime = new Date().getSeconds();
				const creationTime = stat.ctime?.getSeconds() ?? nowTime;

				const elapsedTime = nowTime - creationTime;
				if (elapsedTime >= expiresAfter) {
					await Deno.remove(filePath);
				}
			} else {
				return true;
			}
		}
	} catch (err) {
		if(!(err instanceof Deno.errors.NotFound)) {
			return false;
		}
	}

	const tmpFilePath = `${filePath}.x`;
	const result = await downloadFile(downloadable.url, downloadable.path, displayName);
	if(!result.ok) {
		return false;
	}
	await Deno.rename(tmpFilePath, filePath);
	return true;
}

import { UntarStream } from "@std/tar/untar-stream";
import { normalize } from "@std/path/normalize";
import { unzip, unzipDir } from "@stdx/zip/unzip";
import { Result } from "../result.ts";

export interface ArchiveEntry {
	path: string;
	readable?: ReadableStream<Uint8Array>;
}

export interface ArchiveExtractor {
	extract(
		stream: ReadableStream<Uint8Array<ArrayBuffer>>,
	): AsyncIterable<ArchiveEntry>;
	withoutExtension(filename: string): string;
}

export interface StripFunction {
	consume(path: string): string;
}

export const StripFunction = {
	withDefault(): StripFunction {
		return new (class implements StripFunction {
			consume(path: string): string {
				return path;
			}
		})();
	},

	withDepths(depths: number): StripFunction {
		return new (class implements StripFunction {
			consume(path: string): string {
				if (depths <= 0) return path;
				const parts = path.split("/");
				return parts.slice(depths).join("/");
			}
		})();
	},

	withPrefix(prefix: string): StripFunction {
		return new (class implements StripFunction {
			consume(path: string): string {
				if (path.startsWith(prefix)) {
					return path.slice(prefix.length);
				}
				return path;
			}
		})();
	},
};

function removeExtension(filename: string, extension: string) {
	const idxExt = filename.lastIndexOf(extension);
	if (idxExt === -1) return filename;
	return filename.substring(0, idxExt);
}

export const Extractors = {
	tar(): ArchiveExtractor {
		return {
			async *extract(stream) {
				const untar = stream.pipeThrough(new UntarStream());
				for await (const entry of untar) {
					yield {
						path: entry.path,
						readable: entry.readable,
					};
				}
			},

			withoutExtension(filename) {
				return removeExtension(filename, ".tar");
			},
		};
	},

	tarGz(): ArchiveExtractor {
		return {
			async *extract(stream) {
				const decompressed = stream.pipeThrough(
					new DecompressionStream("gzip"),
				);
				yield* Extractors.tar().extract(decompressed);
			},

			withoutExtension(filename) {
				return removeExtension(filename, ".tar.gz");
			},
		};
	},

	zip(): ArchiveExtractor {
		return {
			async *extract(stream) {
				const chunks: Uint8Array[] = [];
				for await (const chunk of stream) {
					chunks.push(chunk);
				}

				const totalLength = chunks.reduce(
					(acc, c) => acc + c.length,
					0,
				);
				const fullBuffer = new Uint8Array(totalLength);
				let offset = 0;
				for (const chunk of chunks) {
					fullBuffer.set(chunk, offset);
					offset += chunk.length;
				}

				const unzippedFiles = await unzip(fullBuffer);
				const entries =
					unzippedFiles instanceof Map
						? unzippedFiles.entries()
						: Object.entries(unzippedFiles);

				for (const [_, entry] of entries) {
					const isDirectory = entry.path.endsWith("/");

					yield {
						path: entry.path,
						readable: isDirectory
							? undefined
							: new ReadableStream({
									start(controller) {
										controller.enqueue(entry.data);
										controller.close();
									},
								}),
					};
				}
			},

			withoutExtension(filename) {
				return removeExtension(filename, ".zip");
			},
		};
	},
};

export function getExtractorForFileName(
	fileName: string,
): Result<ArchiveExtractor> {
	const lower = fileName.toLowerCase();

	if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
		return Result.success(Extractors.tarGz());
	}
	if (lower.endsWith(".tar")) {
		return Result.success(Extractors.tar());
	}
	if (lower.endsWith(".zip")) {
		return Result.success(Extractors.zip());
	}

	return Result.error(`Unsupported archive format: ${fileName}`);
}

export async function extractArchive(
	archivePath: string,
	outDir: string,
	stripFunction: StripFunction = StripFunction.withDefault(),
): Promise<Result<null>> {
	const result = getExtractorForFileName(archivePath);
	if (!result.ok) return result;
	const extractor: ArchiveExtractor = result.data;

	await Deno.mkdir(outDir, { recursive: true });
	const fs = (await Deno.open(archivePath)).readable;

	const entries = extractor.extract(fs);

	for await (const entry of entries) {
		const path = stripFunction.consume(entry.path);
		if (!path || path === "." || path === "/") {
			continue;
		}

		const target = `${outDir}/${normalize(path)}`;
		if (entry.readable === undefined) {
			await Deno.mkdir(target, { recursive: true });
			continue;
		}
		const file = await Deno.create(target);
		await entry.readable.pipeTo(file.writable);
	}
	return Result.success(null);
}

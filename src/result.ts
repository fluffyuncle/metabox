export class ResultSuccess<T> {
	readonly ok = true as const;

	constructor(readonly data: T) {}
}

export class ResultError extends Error {
	readonly ok = false as const;
	parent: ResultError | null = null

	constructor(
		message: string,
		parent: ResultError | null = null
	) {
		super(message)
		this.parent = parent;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

export class StatusResultError extends ResultError {
	constructor(
		readonly status: number,
		message: string,
		parent: ResultError | null = null,
	) {
		super(message, parent);
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

export class StackResultError extends ResultError {
	constructor(error: unknown, message: string = "Unknown error", parent: ResultError | null = null) {
		super(message, parent);
		this.cause = error;
		if (error instanceof Error && error.stack) {
			this.stack = error.stack;
		}
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

export type Result<T> = ResultSuccess<T> | ResultError;

export type AsyncResult<T> = Promise<Result<T>>;

export type ResultErrorFactory = (parent: ResultError | null) => ResultError;

export const Result = {
	success<T>(data: T): ResultSuccess<T> {
		return new ResultSuccess(data);
	},
	error(message: string, parent: ResultError | null = null): ResultError {
		return new ResultError(message, parent);
	},
	wrap<T>(fn: () => T, message?: string): Result<T> {
		try {
			return new ResultSuccess(fn());
		} catch (err) {
			return new StackResultError(err, message);
		}
	},
	async wrapAsync<T>(fn: () => Promise<T>, message?: string): Promise<Result<T>> {
		try {
			return new ResultSuccess(await fn());
		} catch (err) {
			return new StackResultError(err, message);
		}
	}
};
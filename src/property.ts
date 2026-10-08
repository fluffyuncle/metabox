// deno-lint-ignore-file no-explicit-any
function parsePath(path: string): string[] {
    return path.split(/[.\[\]]+/).filter(Boolean);
}

export function appendProperty(obj: any, path: string, value: unknown): void {
    const parts = parsePath(path);
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const nextPart = parts[i + 1];

        const isNextIndex = /^\d+$/.test(nextPart);

        if (current[part] === undefined || current[part] === null || typeof current[part] !== 'object') {
            current[part] = isNextIndex ? [] : {};
        }

        current = current[part];
    }

    const lastPart = parts[parts.length - 1];

    if (!Array.isArray(current[lastPart])) {
        current[lastPart] = [];
    }

    current[lastPart].push(value);
}

export function setProperty(obj: any, path: string, value: unknown): void {
    const parts = parsePath(path);
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const nextPart = parts[i + 1];

        const isNextIndex = /^\d+\$/.test(nextPart);

        if (current[part] === undefined || current[part] === null || typeof current[part] !== 'object') {
            current[part] = isNextIndex ? [] : {};
        }

        current = current[part];
    }

    const lastPart = parts[parts.length - 1];
    current[lastPart] = value;
}

export function getProperty(obj: any, path: string): any {
    const parts = parsePath(path);
    let current = obj;

    for (const part of parts) {
        if (current === undefined || current === null) {
            return undefined;
        }
        current = current[part];
    }

    return current;
}

export function getPropertyOrCreate(obj: any, path: string): any {
    const parts = parsePath(path);
    let current = obj;

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const nextPart = parts[i + 1];

        if (current[part] === undefined || current[part] === null || typeof current[part] !== 'object') {
            if (nextPart !== undefined) {
                const isNextIndex = /^\d+\$/.test(nextPart);
                current[part] = isNextIndex ? [] : {};
            } else {
                current[part] = {};
            }
        }
        current = current[part];
    }

    return current;
}

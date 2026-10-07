import type { SymbolType } from "./symbol-types.js";

export const CALLABLE_SYMBOL_TYPES = new Set<SymbolType>([
    "METHOD",
    "FUNCTION",
    "CONSTRUCTOR"
]);

export const CONTAINER_SYMBOL_TYPES = new Set<SymbolType>([
    "CLASS",
    "INTERFACE",
    "ENUM"
]);

export interface ResolvableSymbol {
    id: string;
    repositoryId: string;
    fileId: string;
    name: string;
    type: SymbolType;
    startLine: number;
    endLine: number;
}

export interface ResolveTargetInput {
    symbols: ResolvableSymbol[];
    source: ResolvableSymbol;
    targetName: string;
}

export interface SymbolResolverIndex {
    byName: Map<string, ResolvableSymbol[]>;
    byFileId: Map<string, ResolvableSymbol[]>;
}

export function buildSymbolResolverIndex(
    symbols: ResolvableSymbol[]
): SymbolResolverIndex {
    const byName = new Map<string, ResolvableSymbol[]>();
    const byFileId = new Map<string, ResolvableSymbol[]>();

    for (const symbol of symbols) {
        const named = byName.get(symbol.name);
        if (named) {
            named.push(symbol);
        } else {
            byName.set(symbol.name, [symbol]);
        }

        const inFile = byFileId.get(symbol.fileId);
        if (inFile) {
            inFile.push(symbol);
        } else {
            byFileId.set(symbol.fileId, [symbol]);
        }
    }

    return { byName, byFileId };
}

export function findContainingType(
    symbol: ResolvableSymbol,
    fileSymbols: ResolvableSymbol[]
): ResolvableSymbol | null {
    let best: ResolvableSymbol | null = null;
    let bestSpan = Number.POSITIVE_INFINITY;

    for (const candidate of fileSymbols) {
        if (candidate.id === symbol.id) {
            continue;
        }

        if (!CONTAINER_SYMBOL_TYPES.has(candidate.type)) {
            continue;
        }

        if (
            candidate.startLine <= symbol.startLine &&
            candidate.endLine >= symbol.endLine
        ) {
            const span = candidate.endLine - candidate.startLine;
            if (span < bestSpan) {
                best = candidate;
                bestSpan = span;
            }
        }
    }

    return best;
}

function isCallableTarget(symbol: ResolvableSymbol): boolean {
    return CALLABLE_SYMBOL_TYPES.has(symbol.type);
}

/**
 * Deterministic V1 CALLS target resolution.
 *
 * Order:
 * 1. Same file + same containing class/interface/enum, unique callable
 * 2. Same file, unique callable
 * 3. Same repository, unique callable
 *
 * Ambiguous matches (overloads or same name in multiple classes/files
 * with no unique preferred match) return null. Never picks arbitrarily.
 * Only symbols from the provided list are considered; callers must load
 * a single repository's symbols.
 */
export function resolveTargetSymbol(
    input: ResolveTargetInput,
    index?: SymbolResolverIndex
): string | null {
    const { source, targetName } = input;
    const resolverIndex = index ?? buildSymbolResolverIndex(input.symbols);

    const named = resolverIndex.byName.get(targetName) ?? [];
    const candidates = named.filter(
        symbol =>
            symbol.repositoryId === source.repositoryId &&
            isCallableTarget(symbol)
    );

    if (candidates.length === 0) {
        return null;
    }

    if (candidates.length === 1) {
        return candidates[0].id;
    }

    const sameFile = candidates.filter(
        symbol => symbol.fileId === source.fileId
    );
    const fileSymbols = resolverIndex.byFileId.get(source.fileId) ?? [];
    const sourceContainer = findContainingType(source, fileSymbols);

    if (sourceContainer) {
        const sameClass = sameFile.filter(symbol => {
            const container = findContainingType(
                symbol,
                resolverIndex.byFileId.get(symbol.fileId) ?? []
            );
            return container?.id === sourceContainer.id;
        });

        if (sameClass.length === 1) {
            return sameClass[0].id;
        }

        if (sameClass.length > 1) {
            return null;
        }
    }

    if (sameFile.length === 1) {
        return sameFile[0].id;
    }

    if (sameFile.length > 1) {
        return null;
    }

    return null;
}

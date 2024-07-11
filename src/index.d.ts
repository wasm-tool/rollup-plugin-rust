export interface ExperimentalRustOptions {
    directExports?: boolean;
    synchronous?: boolean;
    typescriptDeclarationDir?: string;
    transpileToJS?: boolean;
}

export interface RustOptions {
    serverPath?: string;
    nodejs?: boolean;
    debug?: boolean;
    verbose?: boolean;
    inlineWasm?: boolean;
    cargoArgs?: string[];
    wasmBindgenArgs?: string[];
    wasmOptArgs?: string[];
    watchPatterns?: string[];
    importHook?: (arg0: string) => string;
    experimental?: ExperimentalRustOptions;
}

export default function rust(options?: RustOptions): any;

import * as $path from "node:path";
import { writeString, readString, mkdir } from "./utils.js";


function trim(s) {
    return s.replace(/\n\n\n+/g, "\n\n").replace(/\n\n+\}/g, "\n}").trim();
}


function parse(declaration) {
    declaration = declaration.replace(/export type InitInput = [\s\S]*/g, "");
    return trim(declaration);
}


export async function writeCustom(name, typescriptDir, inline, synchronous) {
    const outPath = $path.join(typescriptDir, name + "_custom.d.ts");

    let output;

    if (synchronous) {
        output = `export type Module = BufferSource | WebAssembly.Module;

export type InitOutput = typeof import("./${name}");

export interface InitOptions {
    module: Module;

    memory?: WebAssembly.Memory;
}

export const module: Uint8Array;

export function init(options: InitOptions): InitOutput;
`;

    } else {
        output = `export type Module = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export type InitOutput = typeof import("./${name}");

export interface InitOptions {
    module: Module | Promise<Module>;

    memory?: WebAssembly.Memory;
}

export const module: ${inline ? "Uint8Array" : "URL"};

export function init(options: InitOptions): Promise<InitOutput>;
`;
    }

    await writeString(outPath, output);
}


export async function write(name, typescriptDir, outDir) {
    const realPath = $path.join(outDir, "index.d.ts");

    const [declaration] = await Promise.all([
        readString(realPath),

        mkdir(typescriptDir),
    ]);

    await writeString($path.join(typescriptDir, name + ".d.ts"), parse(declaration));
}

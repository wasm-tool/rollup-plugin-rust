import * as $path from "node:path";
import * as $toml from "@iarna/toml";
import { createFilter } from "@rollup/pluginutils";
import { glob, rm, read, readString, debug, getEnv } from "./utils.js";
import * as $wasmBindgen from "./wasm-bindgen.js";
import * as $cargo from "./cargo.js";
import * as $wasmOpt from "./wasm-opt.js";
import * as $typescript from "./typescript.js";


const PREFIX = "./.__rollup-plugin-rust__";
const INLINE_ID = "\0__rollup-plugin-rust-inlineWasm__";


function stripPath(path) {
    return path.replace(/\?[^\?]*$/, "");
}


class State {
    constructor(options) {
        // Whether the plugin is running in Vite or not
        this.vite = false;

        // Whether we're in watch mode or not
        this.watch = false;

        // Whether to optimize in release mode
        this.release = true;

        this.fileIds = new Set();

        this.options = options;

        this.cache = {
            nightly: {},
            targetDir: {},
            wasmBindgen: {},
            build: {},
        };
    }

    reset() {
        this.fileIds.clear();

        this.cache.nightly = {};
        this.cache.targetDir = {};
        this.cache.wasmBindgen = {};
        this.cache.build = {};
    }

    setDefaults() {
        if (this.options.watchPatterns == null) {
            this.options.watchPatterns = [
                "src/**"
            ];
        }

        if (this.options.inlineWasm == null) {
            this.options.inlineWasm = false;
        }

        if (this.options.verbose == null) {
            this.options.verbose = false;
        }

        if (this.options.nodejs == null) {
            this.options.nodejs = false;
        }

        if (this.options.optimize == null) {
            this.options.optimize = {};
        }

        if (this.options.optimize.rustc == null) {
            this.options.optimize.rustc = true;
        }

        if (this.options.extraArgs == null) {
            this.options.extraArgs = {};
        }

        if (this.options.extraArgs.cargo == null) {
            this.options.extraArgs.cargo = [];
        }

        if (this.options.extraArgs.wasmBindgen == null) {
            this.options.extraArgs.wasmBindgen = [];
        }

        if (this.options.extraArgs.wasmOpt == null) {
            // TODO figure out better optimization options ?
            this.options.extraArgs.wasmOpt = ["-O"];
        }

        if (this.options.experimental == null) {
            this.options.experimental = {};
        }

        if (this.options.experimental.synchronous == null) {
            this.options.experimental.synchronous = false;
        }
    }

    checkDeprecations(cx) {
        if (this.options.debug != null) {
            cx.warn("The `debug` option has been changed to `optimize.release`");
        }

        if (this.options.cargoArgs != null) {
            cx.warn("The `cargoArgs` option has been changed to `extraArgs.cargo`");
        }

        if (this.options.wasmBindgenArgs != null) {
            cx.warn("The `wasmBindgenArgs` option has been changed to `extraArgs.wasmBindgen`");
        }

        if (this.options.wasmOptArgs != null) {
            cx.warn("The `wasmOptArgs` option has been changed to `extraArgs.wasmOpt`");
        }

        if (this.options.serverPath != null) {
            cx.warn("The `serverPath` option is deprecated and no longer works");
        }

        if (this.options.importHook != null) {
            cx.warn("The `importHook` option is deprecated and no longer works");
        }

        if (this.options.experimental.directExports != null) {
            cx.warn("The `experimental.directExports` option is deprecated and no longer works");
        }
    }


    async watchFiles(cx, dir) {
        if (this.watch) {
            const matches = await Promise.all(this.options.watchPatterns.map((pattern) => glob(pattern, dir)));

            // TODO deduplicate matches ?
            matches.forEach(function (files) {
                files.forEach(function (file) {
                    cx.addWatchFile(file);
                });
            });
        }
    }


    async getNightly(dir) {
        let nightly = this.cache.nightly[dir];

        if (nightly == null) {
            nightly = this.cache.nightly[dir] = $cargo.getNightly(dir);
        }

        return await nightly;
    }


    async getTargetDir(dir) {
        let targetDir = this.cache.targetDir[dir];

        if (targetDir == null) {
            targetDir = this.cache.targetDir[dir] = $cargo.getTargetDir(dir);
        }

        return await targetDir;
    }


    async getWasmBindgen(dir) {
        let bin = getEnv("WASM_BINDGEN_BIN", null);

        if (bin == null) {
            bin = this.cache.wasmBindgen[dir];

            if (bin == null) {
                bin = this.cache.wasmBindgen[dir] = $wasmBindgen.download(dir, this.options.verbose);
            }

            return await bin;

        } else {
            return bin;
        }
    }


    async loadWasm(outDir) {
        const wasmPath = $path.join(outDir, "index_bg.wasm");

        if (this.options.verbose) {
            debug(`Looking for wasm at ${wasmPath}`);
        }

        return await read(wasmPath);
    }


    async compileTypescript(name, outDir) {
        if (this.options.experimental.typescriptDeclarationDir != null) {
            await $typescript.write(
                name,
                this.options.experimental.typescriptDeclarationDir,
                outDir,
            );
        }
    }


    async compileTypescriptCustom(name, isCustom) {
        if (isCustom && this.options.experimental.typescriptDeclarationDir != null) {
            await $typescript.writeCustom(
                name,
                this.options.experimental.typescriptDeclarationDir,
                this.options.inlineWasm,
                this.options.experimental.synchronous,
            );
        }
    }


    async wasmOpt(cx, outDir) {
        if (this.release) {
            const result = await $wasmOpt.run({
                dir: outDir,
                input: "index_bg.wasm",
                output: "wasm_opt.wasm",
                extraArgs: this.options.extraArgs.wasmOpt,
                verbose: this.options.verbose,
            });

            if (result !== null) {
                cx.warn("wasm-opt failed: " + result.message);
            }
        }
    }


    compileInlineWasm(build) {
        const wasmString = JSON.stringify(build.wasm.toString("base64"));

        const code = `
            const base64codes = [62,0,0,0,63,52,53,54,55,56,57,58,59,60,61,0,0,0,0,0,0,0,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,0,0,0,0,0,0,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51];

            function getBase64Code(charCode) {
                return base64codes[charCode - 43];
            }

            function base64Decode(str) {
                let missingOctets = str.endsWith("==") ? 2 : str.endsWith("=") ? 1 : 0;
                let n = str.length;
                let result = new Uint8Array(3 * (n / 4));
                let buffer;

                for (let i = 0, j = 0; i < n; i += 4, j += 3) {
                    buffer =
                        getBase64Code(str.charCodeAt(i)) << 18 |
                        getBase64Code(str.charCodeAt(i + 1)) << 12 |
                        getBase64Code(str.charCodeAt(i + 2)) << 6 |
                        getBase64Code(str.charCodeAt(i + 3));
                    result[j] = buffer >> 16;
                    result[j + 1] = (buffer >> 8) & 0xFF;
                    result[j + 2] = buffer & 0xFF;
                }

                return result.subarray(0, result.length - missingOctets);
            }

            export default base64Decode(${wasmString});
        `;

        return {
            code,
            map: { mappings: '' },
            moduleSideEffects: false,
        };
    }


    compileJsInline(build, isCustom) {
        let mainCode;
        let sideEffects;

        if (this.options.experimental.synchronous) {
            if (isCustom) {
                sideEffects = false;

                mainCode = `export { module };

                export function init(options) {
                    exports.initSync({
                        module: options.module,
                        memory: options.memory,
                    });
                    return exports;
                }`

            } else {
                sideEffects = true;

                mainCode = `
                    exports.initSync({ module });
                    export * from ${build.importPath};
                `;
            }

        } else {
            if (isCustom) {
                sideEffects = false;

                mainCode = `export { module };

                export async function init(options) {
                    await exports.default({
                        module_or_path: await options.module,
                        memory: options.memory,
                    });
                    return exports;
                }`;

            } else {
                sideEffects = true;

                mainCode = `
                    await exports.default({ module_or_path: module });
                    export * from ${build.importPath};
                `;
            }
        }


        const wasmString = JSON.stringify(build.wasm.toString("base64"));

        const code = `
            import * as exports from ${build.importPath};

            import module from "${INLINE_ID}";

            ${mainCode}
        `;

        return {
            code,
            map: { mappings: '' },
            moduleSideEffects: sideEffects,
            meta: {
                "rollup-plugin-rust": { root: false, realPath: build.realPath }
            },
        };
    }


    compileJsNormal(build, isCustom) {
        let wasmPath = `import.meta.ROLLUP_FILE_URL_${build.fileId}`;

        let prelude;

        if (this.options.nodejs) {
            prelude = `function loadFile(url) {
                return new Promise((resolve, reject) => {
                    require("node:fs").readFile(url, (err, data) => {
                        if (err) {
                            reject(err);

                        } else {
                            resolve(data);
                        }
                    });
                });
            }

            const module = loadFile(${wasmPath});`;

        } else {
            prelude = `const module = ${wasmPath};`;
        }


        let mainCode;
        let sideEffects;

        if (this.options.experimental.synchronous) {
            throw new Error("synchronous option can only be used with inlineWasm: true");

        } else {
            if (isCustom) {
                sideEffects = false;

                mainCode = `export { module };

                export async function init(options) {
                    await exports.default({
                        module_or_path: await options.module,
                        memory: options.memory,
                    });
                    return exports;
                }`;

            } else {
                sideEffects = true;

                mainCode = `
                    await exports.default({ module_or_path: module });
                    export * from ${build.importPath};
                `;
            }
        }

        return {
            code: `
                import * as exports from ${build.importPath};

                ${prelude}
                ${mainCode}
            `,
            map: { mappings: '' },
            moduleSideEffects: sideEffects,
            meta: {
                "rollup-plugin-rust": { root: false, realPath: build.realPath }
            },
        };
    }


    compileJs(build, isCustom) {
        if (this.options.inlineWasm) {
            return this.compileJsInline(build, isCustom);

        } else {
            return this.compileJsNormal(build, isCustom);
        }
    }


    async compileRust(cx, dir, id, targetDir, source, nightly) {
        const toml = $toml.parse(source);

        // TODO make this faster somehow
        // TODO does it need to do more transformations on the name ?
        const name = toml.package.name.replace(/\-/g, "_");

        try {
            if (this.options.verbose) {
                debug(`Compiling ${id}`);
                debug(`Using target directory ${targetDir}`);
            }

            await $cargo.run({
                dir,
                nightly,
                verbose: this.options.verbose,
                extraArgs: this.options.extraArgs.cargo,
                release: this.release,
                optimize: this.options.optimize.rustc,
            });

            const wasmPath = $path.resolve($path.join(
                targetDir,
                "wasm32-unknown-unknown",
                (this.release ? "release" : "debug"),
                name + ".wasm"
            ));

            const outDir = $path.resolve($path.join(targetDir, "rollup-plugin-rust", name));

            if (this.options.verbose) {
                debug(`Using rustc output ${wasmPath}`);
                debug(`Using output directory ${outDir}`);
            }

            await rm(outDir);

            await $wasmBindgen.run({
                bin: await this.getWasmBindgen(dir),
                dir,
                wasmPath,
                outDir,
                typescript: this.options.experimental.typescriptDeclarationDir != null,
                extraArgs: this.options.extraArgs.wasmBindgen,
                verbose: this.options.verbose,
            });

            const [wasm] = await Promise.all([
                this.wasmOpt(cx, outDir).then(() => {
                    return this.loadWasm(outDir);
                }),

                this.compileTypescript(name, outDir),
            ]);

            let fileId;

            if (!this.options.inlineWasm) {
                fileId = cx.emitFile({
                    type: "asset",
                    source: wasm,
                    name: name + ".wasm"
                });

                this.fileIds.add(fileId);
            }

            const realPath = $path.join(outDir, "index.js");

            // This returns a fake file path, this ensures that the directory is the
            // same as the Cargo.toml file, which is necessary in order to make npm
            // package imports work correctly.
            const importPath = `"${PREFIX}${name}/index.js"`;

            return { name, outDir, importPath, realPath, wasm, fileId };

        } catch (e) {
            if (this.options.verbose) {
                throw e;

            } else {
                const e = new Error("Rust compilation failed");
                e.stack = null;
                throw e;
            }
        }
    }


    async build(cx, dir, id) {
        // Starts the download for wasm-bindgen early
        this.getWasmBindgen(dir);

        const [nightly, targetDir, source] = await Promise.all([
            this.getNightly(dir),
            this.getTargetDir(dir),
            readString(id),
        ]);

        return await this.compileRust(cx, dir, id, targetDir, source, nightly);
    }


    async load(cx, oldId) {
        const id = stripPath(oldId);

        let promise = this.cache.build[id];

        if (promise == null) {
            const dir = $path.dirname(id);

            promise = this.cache.build[id] = Promise.all([
                this.build(cx, dir, id),
                this.watchFiles(cx, dir),
            ]);
        }

        const [build] = await promise;

        if (oldId.endsWith("?inline")) {
            return this.compileInlineWasm(build);

        } else {
            const isCustom = oldId.endsWith("?custom");

            const [result] = await Promise.all([
                this.compileJs(build, isCustom),
                this.compileTypescriptCustom(build.name, isCustom),
            ]);

            return result;
        }
    }
}


export default function rust(options = {}) {
    // TODO should the filter affect the watching ?
    // TODO should the filter affect the Rust compilation ?
    const filter = createFilter(options.include, options.exclude);

    const state = new State(options);

    state.setDefaults();

    return {
        name: "rust",

        // Vite-specific hook
        configResolved(config) {
            state.vite = true;

            if (config.command !== "build") {
                // We have to force inlineWasm during dev because Vite doesn't support emitFile
                // https://github.com/vitejs/vite/issues/7029
                state.options.inlineWasm = true;
            }
        },

        buildStart(rollup) {
            state.reset();

            state.checkDeprecations(this);

            state.watch = this.meta.watchMode || rollup.watch;

            state.release = (state.options.optimize.release == null
                ? !state.watch
                : state.options.optimize.release);
        },

        // This is only compatible with Rollup 2.78.0 and higher
        resolveId: {
            order: "pre",
            handler(id, importer, info) {
                if (id === INLINE_ID) {
                    return {
                        id: stripPath(importer) + "?inline",
                        meta: {
                            "rollup-plugin-rust": { root: true }
                        }
                    };

                } else {
                    const name = $path.basename(id);

                    const normal = (name === "Cargo.toml");
                    const custom = (name === "Cargo.toml?custom");

                    if ((normal || custom) && filter(id)) {
                        const path = (importer ? $path.resolve($path.dirname(importer), id) : $path.resolve(id));

                        return {
                            id: path,
                            moduleSideEffects: !custom,
                            meta: {
                                "rollup-plugin-rust": { root: true }
                            }
                        };

                    // Rewrites the fake file paths to real file paths.
                    } else if (importer && id[0] === ".") {
                        const info = this.getModuleInfo(importer);

                        if (info && info.meta) {
                            const meta = info.meta["rollup-plugin-rust"];

                            if (meta && !meta.root) {
                                // TODO maybe use resolve ?
                                const path = $path.join($path.dirname(importer), id);

                                const realPath = (id.startsWith(PREFIX)
                                    ? meta.realPath
                                    : $path.join($path.dirname(meta.realPath), id));

                                return {
                                    id: path,
                                    meta: {
                                        "rollup-plugin-rust": {
                                            root: false,
                                            realPath,
                                        }
                                    }
                                };
                            }
                        }
                    }
                }

                return null;
            },
        },

        load(id, loadState) {
            const info = this.getModuleInfo(id);

            if (info && info.meta) {
                const meta = info.meta["rollup-plugin-rust"];

                if (meta) {
                    if (meta.root) {
                        // This causes Vite to load a noop module during SSR
                        if (state.vite && loadState && loadState.ssr) {
                            return {
                                code: `export {};`,
                                map: { mappings: '' },
                                moduleSideEffects: false,
                            };

                        // This compiles the Cargo.toml
                        } else {
                            return state.load(this, id);
                        }

                    } else {
                        if (options.verbose) {
                            debug(`Loading file ${meta.realPath}`);
                        }

                        // This maps the fake path to a real path on disk and loads it
                        return readString(meta.realPath);
                    }
                }
            }

            return null;
        },

        resolveFileUrl(info) {
            if (state.fileIds.has(info.referenceId)) {
                return `new URL(${JSON.stringify(info.fileName)}, import.meta.url)`;

            } else {
                return null;
            }
        },
    };
};

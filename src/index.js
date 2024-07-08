const $path = require("path");
const $toml = require("@iarna/toml");
const { createFilter } = require("@rollup/pluginutils");
const { glob, rm, mv, mkdir, read, readString, writeString, exec, spawn, lock, debug, getEnv } = require("./utils");
const { run_wasm_bindgen } = require("./wasm-bindgen");
const replaceInFiles = require("replace-in-files");
const wasm2jsPath = require.resolve('binaryen/bin/wasm2js');
const rollup = require('rollup');
const { nodeResolve } = require("@rollup/plugin-node-resolve");

const PREFIX = "./.__rollup-plugin-rust__";
const ENTRY_SUFFIX = "?rollup-plugin-rust-entry";


async function get_target_dir(state, dir) {
    let target_dir = state.target_dir_cache[dir];

    if (target_dir == null) {
        const cargo_exec = getEnv("CARGO_BIN", "cargo");
        // TODO make this faster somehow ?
        const metadata = await exec(`${cargo_exec} metadata --format-version 1 --no-deps --color never`, { cwd: dir });
        target_dir = state.target_dir_cache[dir] = JSON.parse(metadata).target_directory;
    }

    return target_dir;
}


async function run_cargo(dir, options) {
    const cargo_exec = getEnv("CARGO_BIN", "cargo");

    let cargo_args = [
        "rustc",
        "--lib",
        "--target", "wasm32-unknown-unknown",
        "--crate-type", "cdylib", // Needed for wasm-bindgen to work
    ];

    // https://doc.rust-lang.org/cargo/reference/profiles.html#dev
    if (options.debug) {
        // Wasm doesn't support unwind
        cargo_args.push("--config");
        cargo_args.push("profile.dev.panic=\"abort\"");

        cargo_args.push("--config");
        cargo_args.push("profile.dev.lto=\"off\"");

        // Speeds up compilation
        // https://github.com/MoonZoon/MoonZoon/issues/170
        cargo_args.push("--config");
        cargo_args.push("profile.dev.debug=false");

    // https://doc.rust-lang.org/cargo/reference/profiles.html#release
    } else {
        cargo_args.push("--release");

        // Wasm doesn't support unwind
        cargo_args.push("--config");
        cargo_args.push("profile.release.panic=\"abort\"");

        // Improves runtime performance and file size
        cargo_args.push("--config");
        cargo_args.push("profile.release.lto=true");

        // Improves runtime performance
        cargo_args.push("--config");
        cargo_args.push("profile.release.codegen-units=1");
    }

    if (options.cargoArgs) {
        cargo_args = cargo_args.concat(options.cargoArgs);
    }

    if (options.verbose) {
        debug(`Running cargo ${cargo_args.join(" ")}`);
    }

    await spawn(cargo_exec, cargo_args, { cwd: dir, stdio: "inherit" });
}


// Replace with @webassemblyjs/wasm-opt ?
async function run_wasm_opt(cx, out_dir, options) {
    const path = "index_bg.wasm";
    const tmp = "wasm_opt.wasm";

    // Needed to make wasm-opt work on Windows
    const wasm_opt_command = getEnv("WASM_OPT_BIN", (process.platform === "win32" ? "wasm-opt.cmd" : "wasm-opt"));

    const wasm_opt_args = [path, "--output", tmp].concat(options.wasmOptArgs);

    if (options.verbose) {
        debug(`Running ${wasm_opt_command} ${wasm_opt_args.join(" ")}`);
    }

    try {
        await spawn(wasm_opt_command, wasm_opt_args, { cwd: out_dir, stdio: "inherit" });

    } catch (e) {
        cx.warn("wasm-opt failed: " + e.message);
        return;
    }

    await mv($path.join(out_dir, tmp), $path.join(out_dir, path));
}


async function load_wasm(out_dir, options) {
    const wasm_path = $path.join(out_dir, "index_bg.wasm");

    if (options.verbose) {
        debug(`Looking for wasm at ${wasm_path}`);
    }

    return await read(wasm_path);
}

async function bundleJS(path) {
    const bundle = await rollup.rollup({
        input: path,
        plugins: [ nodeResolve() ],
    });
    
    const { output } = await bundle.generate({
        format: 'es',
    });
    
    return output[0].code;
}

async function run_wasm2js(out_dir, name, options) {
    const wasm2js_args = [
        $path.join(out_dir, "index_bg.wasm"),
        "-o", $path.join(out_dir, name+".js"),
    ];

    if (options.verbose) {
        debug(`Running ${wasm2js_args.join(" ")}`);
    }

    let jsContent;
    try {
        await spawn(wasm2jsPath, wasm2js_args, { cwd: out_dir, stdio: "inherit" });
        
        await replaceInFiles({
            files: [
                $path.join(out_dir, "index.js"),
                $path.join(out_dir, "index_bg.js"),
            ],
            from: /index_bg\.wasm/g,
            to: name + ".js",
        });

        jsContent = await bundleJS($path.join(out_dir, "index.js"));
    } catch (e) {
        if (options.verbose) {
            throw e;
        } else {
            const e = new Error("wasm2js failed");
            e.stack = null;
            throw e;
        }
    }
    
    return {name, compiledOutput: jsContent.toString(), out_dir};
}

async function compile_rust(cx, dir, id, target_dir, source, options) {
    const toml = $toml.parse(source);

    // TODO make this faster somehow
    // TODO does it need to do more transformations on the name ?
    const name = toml.package.name.replace(/\-/g, "_");

    try {
        // TODO maybe it can run `cargo fetch` without locking ?
        return await lock(async function () {
            if (options.verbose) {
                debug(`Compiling ${id}`);
                debug(`Using target directory ${target_dir}`);
            }

            await run_cargo(dir, options);

            const wasm_path = $path.resolve($path.join(
                target_dir,
                "wasm32-unknown-unknown",
                (options.debug ? "debug" : "release"),
                name + ".wasm"
            ));

            const out_dir = $path.resolve($path.join(target_dir, "rollup-plugin-rust", name));

            if (options.verbose) {
                debug(`Using rustc output ${wasm_path}`);
                debug(`Using output directory ${out_dir}`);
            }

            await rm(out_dir);

            await run_wasm_bindgen(dir, wasm_path, out_dir, options);

            if (!options.debug) {
                await run_wasm_opt(cx, out_dir, options);
            }

            const compiledOutput = await load_wasm(out_dir, options);
            
            if(options.experimental.transpileToJS) {
                return run_wasm2js(out_dir, name, options);
            }

            return { name, compiledOutput, out_dir };
        });

    } catch (e) {
        if (options.verbose) {
            throw e;

        } else {
            const e = new Error("Rust compilation failed");
            e.stack = null;
            throw e;
        }
    }
}


async function watch_files(cx, dir, options) {
    if (options.watch) {
        const matches = await Promise.all(options.watchPatterns.map(function (pattern) {
            return glob(pattern, dir);
        }));

        // TODO deduplicate matches ?
        matches.forEach(function (files) {
            files.forEach(function (file) {
                cx.addWatchFile(file);
            });
        });
    }
}


async function build(cx, state, id, options) {
    const dir = $path.dirname(id);

    const [target_dir, source] = await Promise.all([
        // TODO does this need to be behind the lock too ?
        get_target_dir(state, dir),
        readString(id),
    ]);

    const [output] = await Promise.all([
        compile_rust(cx, dir, id, target_dir, source, options),
        watch_files(cx, dir, options),
    ]);

    return output;
}


function compile_js_inline(options, import_path, real_path, compiledOutput, is_entry) {
    let export_code;

    if (!is_entry && options.experimental.directExports) {
        export_code = `export * from ${import_path};`;

    } else {
        export_code = "";
    }

    if(options.experimental.transpileToJS) {
        if (!options.experimental.directExports) {
            throw new Error("transpileToJS can only be used with experimental.directExports: true");
        }
        if(!options.experimental.synchronous) {
            throw new Error("transpileToJS can only be used with experimental.synchronous: true");
        }

        return {
            code: compiledOutput,
            map: { mappings: '' },
            moduleSideEffects: true,
            meta: {
                "rollup-plugin-rust": { root: false, real_path }
            },
        };
    }

    let main_code;
    let sideEffects;

    if (options.experimental.synchronous) {
        if (is_entry || options.experimental.directExports) {
            sideEffects = true;
            main_code = `exports.initSync(wasm_code);`

        } else {
            sideEffects = false;
            main_code = `export default () => {
                exports.initSync(wasm_code);
                return exports;
            };`;
        }

    } else {
        if (options.experimental.directExports) {
            sideEffects = true;
            main_code = `await exports.default(wasm_code);`;

        } else if (is_entry) {
            sideEffects = true;
            main_code = `exports.default(wasm_code).catch(console.error);`

        } else {
            sideEffects = false;
            main_code = `export default async (opt = {}) => {
                let {initializeHook} = opt;

                if (initializeHook != null) {
                    await initializeHook(exports.default, wasm_code);

                } else {
                    await exports.default(wasm_code);
                }

                return exports;
            };`;
        }
    }


    const wasm_string = JSON.stringify(compiledOutput.toString("base64"));

    const code = `
        ${export_code}
        import * as exports from ${import_path};

        const base64codes = [62,0,0,0,63,52,53,54,55,56,57,58,59,60,61,0,0,0,0,0,0,0,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,0,0,0,0,0,0,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51];

        function getBase64Code(charCode) {
            return base64codes[charCode - 43];
        }

        function base64_decode(str) {
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

        const wasm_code = base64_decode(${wasm_string});

        ${main_code}
    `;


    return {
        code,
        map: { mappings: '' },
        moduleSideEffects: sideEffects,
        meta: {
            "rollup-plugin-rust": { root: false, real_path }
        },
    };
}


function compile_js_load(cx, state, options, import_path, real_path, name, wasm, is_entry) {
    let fileId;
    if(options.experimental.transpileToJS) {
        throw new Error("transpileToJS can only be used with inlineWasm: true");
    }

    if (options.outDir == null) {
        fileId = cx.emitFile({
            type: "asset",
            source: wasm,
            name: name + ".wasm"
        });

    } else {
        cx.warn("The outDir option is deprecated, use output.assetFileNames instead");

        const wasm_name = $path.posix.join(options.outDir, name + ".wasm");

        fileId = cx.emitFile({
            type: "asset",
            source: wasm,
            fileName: wasm_name
        });
    }

    state.file_ids.add(fileId);


    let wasm_path = `import.meta.ROLLUP_FILE_URL_${fileId}`;

    let initialize = `exports.default(final_path)`;

    let prelude = "";

    if (options.nodejs) {
        prelude = `
        function loadFile(url) {
            return new Promise((resolve, reject) => {
                require("fs").readFile(url, (err, data) => {
                    if (err) {
                        reject(err);

                    } else {
                        resolve(data);
                    }
                });
            });
        }`;

        initialize = `exports.default(loadFile(final_path))`;
    }


    let export_code = "";

    if (!is_entry && options.experimental.directExports) {
        export_code = `export * from ${import_path};`;
    }


    let main_code;
    let sideEffects;

    if (options.experimental.synchronous) {
        throw new Error("synchronous option can only be used with inlineWasm: true");

    } else {
        if (options.experimental.directExports) {
            sideEffects = true;
            main_code = `const final_path = wasm_path; await ${initialize};`;

        } else if (is_entry) {
            sideEffects = true;
            main_code = `const final_path = wasm_path; ${initialize}.catch(console.error);`

        } else {
            sideEffects = false;
            main_code = `export default async (opt = {}) => {
                let {importHook, serverPath, initializeHook} = opt;

                let final_path = wasm_path;

                if (serverPath != null) {
                    final_path = serverPath + /[^\\/\\\\]*$/.exec(final_path)[0];
                }

                if (importHook != null) {
                    final_path = importHook(final_path);
                }

                if (initializeHook != null) {
                    await initializeHook(exports.default, final_path);

                } else {
                    await ${initialize};
                }

                return exports;
            };`;
        }
    }


    return {
        code: `
            ${export_code}
            import * as exports from ${import_path};

            const wasm_path = ${wasm_path};

            ${prelude}
            ${main_code}

            export const __META__ = {
                wasm_bindgen: {
                    js_path: ${import_path},
                    wasm_path: wasm_path,
                },
            };
        `,
        map: { mappings: '' },
        moduleSideEffects: sideEffects,
        meta: {
            "rollup-plugin-rust": { root: false, real_path }
        },
    };
}


function compile_js(cx, state, name, compiledOutput, is_entry, out_dir, options) {
    const real_path = $path.join(out_dir, "index.js");

    // This returns a fake file path, this ensures that the directory is the
    // same as the Cargo.toml file, which is necessary in order to make npm
    // package imports work correctly.
    const import_path = `"${PREFIX}${name}/index.js"`;

    if (options.inlineWasm || options.transpileToJS) {
        return compile_js_inline(options, import_path, real_path, compiledOutput, is_entry);

    } else {
        return compile_js_load(cx, state, options, import_path, real_path, name, compiledOutput, is_entry);
    }
}

function trim(s) {
    return s.replace(/\n\n\n+/g, "\n\n").replace(/\n\n+\}/g, "\n}").trim();
}

function parse_dts(declaration, options) {
    declaration = declaration.replace(/export type InitInput = [\s\S]*/g, "");
    return trim(declaration);
}

async function compile_dts_init(out_path, name, options) {
    if (!options.experimental.directExports) {
        const output = `export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export type InitOutput = typeof import("./${name}");

export interface InitOptions {
    serverPath?: string;

    importHook?: (path: string) => InitInput | Promise<InitInput>;

    initializeHook?: (
        init: (path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory) => void,
        path: InitInput | Promise<InitInput>,
    ) => Promise<void>;
}

declare const init: (options?: InitOptions) => Promise<InitOutput>;
export default init;
`;

        await writeString(out_path, output);
    }
}


async function compile_dts(cx, state, name, out_dir, options) {
    const dir = options.experimental.typescriptDeclarationDir;

    if (dir != null) {
        const real_path = $path.join(out_dir, "index.d.ts");

        const [declaration] = await Promise.all([
            readString(real_path),
            mkdir(dir),
        ]);

        await Promise.all([
            writeString($path.join(dir, name + ".d.ts"), parse_dts(declaration, options)),
            compile_dts_init($path.join(dir, name + "_init.d.ts"), name, options),
        ]);
    }
}


async function load_cargo_toml(cx, state, id, is_entry, meta, options) {
    let result = state.cargo_toml_cache[id];

    if (result == null) {
        result = state.cargo_toml_cache[id] = build(cx, state, id, options);
    }

    result = await result;

    await compile_dts(cx, state, result.name, result.out_dir, options);

    return compile_js(cx, state, result.name, result.compiledOutput, is_entry, result.out_dir, options);
}

/**
 * @typedef {Object} ExperimentalRustOptions
 * @property {boolean} [directExports]
 * @property {boolean} [synchronous]
 * @property {string} [typescriptDeclarationDir]
 * @property {boolean} [transpileToJS]
 */

/**
 * @typedef {Object} RustOptions
 * @property {string} [serverPath]
 * @property {boolean} [nodejs]
 * @property {boolean} [debug]
 * @property {boolean} [verbose]
 * @property {boolean} [inlineWasm]
 * @property {string[]} [cargoArgs]
 * @property {string[]} [wasmBindgenArgs]
 * @property {string[]} [wasmOptArgs]
 * @property {string[]} [watchPatterns]
 * @property {(string)=>string} [importHook]
 * @property {ExperimentalRustOptions} [experimental]
 */

/**
 * @param {RustOptions} options
 */
module.exports = function rust(options = {}) {
    
    // TODO should the filter affect the watching ?
    // TODO should the filter affect the Rust compilation ?
    const filter = createFilter(options.include, options.exclude);

    const state = {
        // Whether the plugin is running in Vite or not
        vite: false,
        file_ids: new Set(),
        target_dir_cache: {},
        cargo_toml_cache: {},
    };

    if (options.watchPatterns == null) {
        options.watchPatterns = [
            "src/**"
        ];
    }

    if (options.importHook == null) {
        options.importHook = function (path) { return JSON.stringify(path); };
    }

    if (options.serverPath == null) {
        options.serverPath = "";
    }

    if (options.wasmOptArgs == null) {
        // TODO figure out better optimization options ?
        options.wasmOptArgs = ["-O"];
    }

    if (options.inlineWasm == null) {
        options.inlineWasm = false;
    }
    
    if (options.verbose == null) {
        options.verbose = false;
    }

    if (options.nodejs == null) {
        options.nodejs = false;
    }

    if (options.experimental == null) {
        options.experimental = {};
    }

    if (options.experimental.directExports == null) {
        options.experimental.directExports = false;
    }

    if (options.experimental.synchronous == null) {
        options.experimental.synchronous = false;
    }
    
    if(options.experimental.transpileToJS == null) {
        options.experimental.transpileToJS = false;
    }

    return {
        name: "rust",

        // Vite-specific hook
        configResolved(config) {
            state.vite = true;

            if (config.command !== "build") {
                // We have to force inlineWasm during dev because Vite doesn't support emitFile
                // https://github.com/vitejs/vite/issues/7029
                options.inlineWasm = true;
            }
        },

        buildStart(rollup) {
            state.file_ids.clear();
            state.target_dir_cache = {};
            state.cargo_toml_cache = {};

            if (options.wasmPackPath !== undefined) {
                this.warn("The wasmPackPath option is deprecated and no longer works");
            }

            if (this.meta.watchMode || rollup.watch) {
                if (options.watch == null) {
                    options.watch = true;
                }

                if (options.debug == null) {
                    options.debug = true;
                }
            }
        },

        // This is only compatible with Rollup 2.78.0 and higher
        resolveId: {
            order: "pre",
            handler(id, importer, info) {
                if ($path.basename(id) === "Cargo.toml" && filter(id)) {
                    const path = (importer ? $path.resolve($path.dirname(importer), id) : $path.resolve(id));

                    // This adds a suffix so that the load hook can reliably detect whether it's an entry or not.
                    // This is needed because isEntry is ONLY reliable inside of resolveId.
                    if (info.isEntry) {
                        return {
                            id: `${path}${ENTRY_SUFFIX}`,
                            meta: {
                                "rollup-plugin-rust": { root: true }
                            }
                        };

                    } else {
                        return {
                            id: path,
                            moduleSideEffects: false,
                            meta: {
                                "rollup-plugin-rust": { root: true }
                            }
                        };
                    }

                // Rewrites the fake file paths to real file paths.
                } else if (importer && id[0] === ".") {
                    const info = this.getModuleInfo(importer);

                    if (info && info.meta) {
                        const meta = info.meta["rollup-plugin-rust"];

                        if (meta && !meta.root) {
                            // TODO maybe use resolve ?
                            const path = $path.join($path.dirname(importer), id);

                            const real_path = (id.startsWith(PREFIX)
                                ? meta.real_path
                                : $path.join($path.dirname(meta.real_path), id));

                            return {
                                id: path,
                                meta: {
                                    "rollup-plugin-rust": {
                                        root: false,
                                        real_path,
                                    }
                                }
                            };
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
                            if (id.endsWith(ENTRY_SUFFIX)) {
                                return {
                                    code: ``,
                                    map: { mappings: '' },
                                    moduleSideEffects: false,
                                };

                            } else {
                                return {
                                    code: `
                                        export default async function (opt = {}) {
                                            return {};
                                        }
                                    `,
                                    map: { mappings: '' },
                                    moduleSideEffects: false,
                                };
                            }

                        // This compiles the Cargo.toml
                        } else {
                            if (id.endsWith(ENTRY_SUFFIX)) {
                                return load_cargo_toml(this, state, id.slice(0, -ENTRY_SUFFIX.length), true, meta, options);

                            } else {
                                return load_cargo_toml(this, state, id, false, meta, options);
                            }
                        }

                    } else {
                        if (options.verbose) {
                            debug(`Loading file ${meta.real_path}`);
                        }

                        // This maps the fake path to a real path on disk and loads it
                        return readString(meta.real_path);
                    }
                }
            }

            return null;
        },

        resolveFileUrl(info) {
            if (state.file_ids.has(info.referenceId)) {
                return options.importHook(options.serverPath + info.fileName);

            } else {
                return null;
            }
        },
    };
};

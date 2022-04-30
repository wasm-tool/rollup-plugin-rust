const $path = require("path");
const $toml = require("toml");
const { createFilter } = require("rollup-pluginutils");
const { glob, rm, mv, read, readString, exec, spawn, lock, debug } = require("./utils");
const { run_wasm_bindgen } = require("./wasm-bindgen");


const PREFIX = "./.__rollup-plugin-rust__";
const ENTRY_SUFFIX = "?rollup-plugin-rust-entry";


async function get_target_dir(state, dir) {
    let target_dir = state.target_dir_cache[dir];

    if (target_dir == null) {
        // TODO make this faster somehow ?
        const metadata = await exec("cargo metadata --format-version 1 --no-deps --color never", { cwd: dir });
        target_dir = state.target_dir_cache[dir] = JSON.parse(metadata).target_directory;
    }

    return target_dir;
}


function validate_toml(toml) {
    if (toml.lib && Array.isArray(toml.lib["crate-type"]) && toml.lib["crate-type"].indexOf("cdylib") !== -1) {
        return;
    }

    throw new Error("Cargo.toml must use `crate-type = [\"cdylib\"]`");
}


async function run_cargo(dir, options) {
    let cargo_args = [
        "build",
        "--lib",
        "--target", "wasm32-unknown-unknown",
    ];

    if (!options.debug) {
        cargo_args.push("--release");
    }

    if (options.cargoArgs) {
        cargo_args = cargo_args.concat(options.cargoArgs);
    }

    if (options.verbose) {
        debug(`Running cargo ${cargo_args.join(" ")}`);
    }

    await spawn("cargo", cargo_args, { cwd: dir, stdio: "inherit" });
}


// Replace with @webassemblyjs/wasm-opt ?
async function run_wasm_opt(cx, out_dir, options) {
    const path = "index_bg.wasm";
    const tmp = "wasm_opt.wasm";

    // Needed to make wasm-opt work on Windows
    const wasm_opt_command = (process.platform === "win32" ? "wasm-opt.cmd" : "wasm-opt");

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


async function compile_rust(cx, dir, id, target_dir, source, options) {
    const toml = $toml.parse(source);

    validate_toml(toml);

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

            const wasm = await load_wasm(out_dir, options);

            return { name, wasm, out_dir };
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


async function compile_js(cx, state, name, wasm, is_entry, out_dir, options) {
    const real_path = $path.join(out_dir, "index.js");

    // This returns a fake file path, this ensures that the directory is the
    // same as the Cargo.toml file, which is necessary in order to make npm
    // package imports work correctly.
    const import_path = `"${PREFIX}${name}/index.js"`;

    if (options.inlineWasm) {
        const base64_decode = `
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
        `;

        const wasm_string = JSON.stringify(wasm.toString("base64"));

        if (is_entry) {
            return {
                code: `
                    import init from ${import_path};

                    ${base64_decode}

                    const wasm_code = base64_decode(${wasm_string});

                    init(wasm_code).catch(console.error);
                `,
                map: { mappings: '' },
                meta: {
                    "rollup-plugin-rust": { root: false, real_path }
                },
            };

        } else {
            return {
                code: `
                    import * as exports from ${import_path};

                    ${base64_decode}

                    const wasm_code = base64_decode(${wasm_string});

                    export default async () => {
                        await exports.default(wasm_code);
                        return exports;
                    };
                `,
                map: { mappings: '' },
                moduleSideEffects: false,
                meta: {
                    "rollup-plugin-rust": { root: false, real_path }
                },
            };
        }

    } else {
        let fileId;

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

        let import_wasm = `import.meta.ROLLUP_FILE_URL_${fileId}`;

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

            import_wasm = `loadFile(${import_wasm})`;
        }

        if (is_entry) {
            return {
                code: `
                    import init from ${import_path};
                    ${prelude}

                    init(${import_wasm}).catch(console.error);
                `,
                map: { mappings: '' },
                meta: {
                    "rollup-plugin-rust": { root: false, real_path }
                },
            };

        } else {
            return {
                code: `
                    import * as exports from ${import_path};
                    ${prelude}

                    export default async (opt = {}) => {
                        let {importHook, serverPath} = opt;

                        let path = ${import_wasm};

                        if (serverPath != null) {
                            path = serverPath + /[^\\/\\\\]*$/.exec(path)[0];
                        }

                        if (importHook != null) {
                            path = importHook(path);
                        }

                        await exports.default(path);
                        return exports;
                    };
                `,
                map: { mappings: '' },
                moduleSideEffects: false,
                meta: {
                    "rollup-plugin-rust": { root: false, real_path }
                },
            };
        }
    }
}


async function load_cargo_toml(cx, state, id, is_entry, meta, options) {
    let result = state.cargo_toml_cache[id];

    if (result == null) {
        result = state.cargo_toml_cache[id] = build(cx, state, id, options);
    }

    result = await result;

    return compile_js(cx, state, result.name, result.wasm, is_entry, result.out_dir, options);
}


module.exports = function rust(options = {}) {
    // TODO should the filter affect the watching ?
    // TODO should the filter affect the Rust compilation ?
    const filter = createFilter(options.include, options.exclude);

    const state = {
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

    return {
        name: "rust",

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

        // TODO Incredible hack to work around this bug in Rollup:
        //      https://github.com/rollup/plugins/issues/1169
        options(rawOptions) {
            // We inject the resolver in the beginning so that "catch-all-resolver" like node-resolve
            // do not prevent our plugin from resolving entry points.
            const plugins = Array.isArray(rawOptions.plugins)
                ? [...rawOptions.plugins]
                : rawOptions.plugins
                ? [rawOptions.plugins]
                : [];

            plugins.unshift({
                name: "rust--resolver",
                resolveId(id, importer, info) {
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
            });

            return { ...rawOptions, plugins };
        },

        load(id) {
            const info = this.getModuleInfo(id);

            if (info && info.meta) {
                const meta = info.meta["rollup-plugin-rust"];

                if (meta) {
                    if (meta.root) {
                        // This compiles the Cargo.toml
                        if (id.endsWith(ENTRY_SUFFIX)) {
                            return load_cargo_toml(this, state, id.slice(0, -ENTRY_SUFFIX.length), true, meta, options);

                        } else {
                            return load_cargo_toml(this, state, id, false, meta, options);
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

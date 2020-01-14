const $fs = require("fs");
const $glob = require("glob");
const $path = require("path");
const $child = require("child_process");
const $toml = require("toml");
const $rimraf = require("rimraf");
const { createFilter } = require("rollup-pluginutils");


function glob(pattern, cwd) {
    return new Promise(function (resolve, reject) {
        $glob(pattern, {
            cwd: cwd,
            strict: true,
            absolute: true,
            nodir: true
        }, function (err, files) {
            if (err) {
                reject(err);

            } else {
                resolve(files);
            }
        });
    });
}

function rm(path) {
    return new Promise(function (resolve, reject) {
        $rimraf(path, { glob: false }, function (err) {
            if (err) {
                reject(err);

            } else {
                resolve();
            }
        });
    });
}

function read(path) {
    return new Promise(function (resolve, reject) {
        $fs.readFile(path, function (err, file) {
            if (err) {
                reject(err);

            } else {
                resolve(file);
            }
        });
    });
}

function wait(p) {
    return new Promise((resolve, reject) => {
        p.on("close", (code) => {
            if (code === 0) {
                resolve();

            } else {
                reject(new Error("Command `" + p.spawnargs.join(" ") + "` failed with error code: " + code));
            }
        });

        p.on("error", reject);
    });
}


const state = {
    locked: false,
    pending: [],
};

async function lock(f) {
    if (state.locked) {
        await new Promise(function (resolve, reject) {
            state.pending.push(resolve);
        });

        if (state.locked) {
            throw new Error("Invalid lock state");
        }
    }

    state.locked = true;

    try {
        return await f();

    } finally {
        state.locked = false;

        if (state.pending.length !== 0) {
            const resolve = state.pending.shift();
            // Wake up pending task
            resolve();
        }
    }
}


async function wasm_pack(cx, dir, source, id, options) {
    const toml = $toml.parse(source);

    const name = toml.package.name;

    // TODO use some logic to find the target dir
    const out_dir = $path.resolve($path.join("target", "wasm-pack", name));

    await rm(out_dir);

    const args = [
        // TODO adjust based on Webpack's error report level
        //"--log-level", "error",
        "build",
        "--out-dir", out_dir,
        "--out-name", "index",
        "--target", "web",
        "--no-typescript",
        (options.debug ? "--dev" : "--release")
    ];

    try {
        // TODO what if it tries to build the same crate multiple times ?
        await lock(async function () {
            // TODO pretty hacky, but needed to make it work on Windows
            const command = (process.platform === "win32" ? "wasm-pack.cmd" : "wasm-pack");

            await wait($child.spawn(command, args, { cwd: dir, stdio: "inherit" }));
        });

    } catch (e) {
        if (e.code === "ENOENT") {
            throw new Error("Could not find wasm-pack, make sure it is installed");

        } else if (options.verbose) {
            throw e;

        } else {
            throw new Error("");
        }
    }

    const wasm = await read($path.join(out_dir, "index_bg.wasm"));

    // TODO use the [name] somehow
    // TODO generate random name ?
    const wasm_name = $path.posix.join(options.outdir, name + ".wasm");

    cx.emitFile({
        type: "asset",
        source: wasm,
        fileName: wasm_name
    });

    // TODO better way to generate the path
    const import_path = JSON.stringify($path.join(".", $path.relative(dir, $path.join(out_dir, "index.js"))));

    const import_wasm = options.importHook(wasm_name);

    const is_entry = cx.getModuleInfo(id).isEntry;

    if (is_entry) {
        return {
            code: `
                import init from ${import_path};

                init(${import_wasm}).catch(console.error);
            `,
            map: { mappings: '' }
        };

    // TODO this is probably wrong
    } else {
        return {
            code: `
                import init from ${import_path};

                export default init(${import_wasm});
            `,
            map: { mappings: '' }
        };
    }
}


async function watch_files(cx, dir, options) {
    if (options.watch) {
        const matches = await await Promise.all(options.watchPatterns.map(function (pattern) {
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


async function build(cx, source, id, options) {
    const dir = $path.dirname(id);

    const [output] = await Promise.all([
        wasm_pack(cx, dir, source, id, options),
        watch_files(cx, dir, options),
    ]);

    return output;
}


module.exports = function rust(options = {}) {
    // TODO should the filter affect the watching ?
    // TODO should the filter affect the Rust compilation ?
    const filter = createFilter(options.include, options.exclude);

    if (options.watchPatterns == null) {
        options.watchPatterns = [
            "src/**"
        ];
    }

    if (options.importHook == null) {
        options.importHook = function (path) { return JSON.stringify(path); };
    }

    // TODO use output.assetFileNames
    if (options.outdir == null) {
        options.outdir = "";
    }

    if (options.verbose == null) {
        options.verbose = false;
    }

    return {
        name: "rust",

        buildStart(rollup) {
            if (rollup.watch) {
                if (options.watch == null) {
                    options.watch = true;
                }

                if (options.debug == null) {
                    options.debug = true;
                }
            }
        },

        transform(source, id) {
            if ($path.basename(id) === "Cargo.toml" && filter(id)) {
                return build(this, source, id, options);

            } else {
                return null;
            }
        },
    };
};

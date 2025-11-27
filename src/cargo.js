import { getEnv, exec, debug, spawn, Lock } from "./utils.js";


const GLOBAL_LOCK = new Lock();


export class Nightly {
    constructor(year, month, day) {
        this.year = year;
        this.month = month;
        this.day = day;
    }

    greaterThan(other) {
        if (this.year > other.year) {
            return true;

        } else if (this.year === other.year) {
            if (this.month > other.month) {
                return true;

            } else if (this.month === other.month) {
                return this.day > other.day;

            } else {
                return false;
            }

        } else {
            return false;
        }
    }

    supportsImmediateAbort() {
        return this.greaterThan(new Nightly(2025, 10, 4));
    }
}


export async function getNightly(dir) {
    const bin = getEnv("CARGO_BIN", "cargo");

    // TODO make this faster somehow ?
    const version = await exec(`${bin} --version`, { cwd: dir });

    const a = /\-nightly \([^ ]+ ([0-9]+)\-([0-9]+)\-([0-9]+)\)/.exec(version);

    if (a) {
        return new Nightly(+a[1], +a[2], +a[3]);

    } else {
        return null;
    }
}


export async function getTargetDir(dir) {
    const bin = getEnv("CARGO_BIN", "cargo");

    // TODO make this faster somehow ?
    const metadata = await exec(`${bin} metadata --format-version 1 --no-deps --color never`, { cwd: dir });

    return JSON.parse(metadata)["target_directory"];
}


export async function getVersion(dir, name) {
    const bin = getEnv("CARGO_BIN", "cargo");
    const spec = await exec(`${bin} pkgid ${name}`, { cwd: dir });

    const version = /([\d\.]+)[\r\n]*$/.exec(spec);

    if (version) {
        return version[1];

    } else {
        throw new Error(`Could not determine ${name} version`);
    }
}


export async function run({ dir, verbose, cargoArgs, rustcArgs, release, optimize, nightly, atomics, strip }) {
    const cargoBin = getEnv("CARGO_BIN", "cargo");

    let args = [
        "rustc",
        "--lib",
        "--target", "wasm32-unknown-unknown",
        "--crate-type", "cdylib", // Needed for wasm-bindgen to work
    ];

    let rustflags = [];

    if (atomics) {
        rustflags.push(
            "-C", "target-feature=+atomics,+bulk-memory,+mutable-globals",
            "-C", "link-args=--shared-memory",
            "-C", "link-args=--import-memory",

            "-C", "link-args=--export=__wasm_init_tls",
            "-C", "link-args=--export=__tls_size",
            "-C", "link-args=--export=__tls_align",
            "-C", "link-args=--export=__tls_base",
        );

        args.push("-Z", "build-std=panic_abort,core,std,alloc,proc_macro");
    }

    // https://doc.rust-lang.org/cargo/reference/profiles.html#release
    if (release) {
        args.push("--release");

        if (nightly) {
            if (strip.location.get()) {
                rustflags.push("-Z", "location-detail=none");
            }

            if (strip.formatDebug.get()) {
                rustflags.push("-Z", "fmt-debug=none");
            }
        }

        if (optimize) {
            // Wasm doesn't support unwind, so we abort instead
            if (nightly && nightly.supportsImmediateAbort()) {
                // Reduces file size by removing panic strings
                args.push("--config");
                args.push("profile.release.panic=\"immediate-abort\"");

            } else {
                args.push("--config");
                args.push("profile.release.panic=\"abort\"");
            }

            // Improves runtime performance and file size
            args.push("--config");
            args.push("profile.release.lto=true");

            // Improves runtime performance
            args.push("--config");
            args.push("profile.release.codegen-units=1");

            // Reduces file size
            args.push("--config");
            args.push("profile.release.strip=true");

            // Reduces file size by removing panic strings
            if (nightly) {
                if (nightly.supportsImmediateAbort()) {
                    args.push("-Z", "panic-immediate-abort");
                }

                args.push("-Z", "build-std=panic_abort,core,std,alloc,proc_macro");
                args.push("-Z", "build-std-features=optimize_for_size");
            }
        }

    // https://doc.rust-lang.org/cargo/reference/profiles.html#dev
    } else {
        if (optimize) {
            // Wasm doesn't support unwind
            args.push("--config");
            args.push("profile.dev.panic=\"abort\"");

            args.push("--config");
            args.push("profile.dev.lto=\"off\"");

            // Speeds up compilation
            // https://github.com/MoonZoon/MoonZoon/issues/170
            args.push("--config");
            args.push("profile.dev.debug=false");
        }
    }

    rustflags = rustflags.concat(rustcArgs);

    if (rustflags.length > 0) {
        args.push("--config", "build.rustflags=" + JSON.stringify(rustflags));
    }

    args = args.concat(cargoArgs);

    await GLOBAL_LOCK.withLock(async () => {
        if (verbose) {
            debug(`Running cargo ${args.join(" ")}`);
        }

        await spawn(cargoBin, args, { cwd: dir, stdio: "inherit" });
    });
}

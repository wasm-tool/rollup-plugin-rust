import { getEnv, exec, debug, spawn, Lock } from "./utils.js";


const GLOBAL_LOCK = new Lock();


export async function getNightly(dir) {
    const bin = getEnv("CARGO_BIN", "cargo");

    // TODO make this faster somehow ?
    const version = await exec(`${bin} --version`, { cwd: dir });

    return /\-nightly /.test(version);
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


export async function run({ dir, verbose, extraArgs, release, optimize, nightly }) {
    const cargoBin = getEnv("CARGO_BIN", "cargo");

    let args = [
        "rustc",
        "--lib",
        "--target", "wasm32-unknown-unknown",
        "--crate-type", "cdylib", // Needed for wasm-bindgen to work
    ];

    // https://doc.rust-lang.org/cargo/reference/profiles.html#release
    if (release) {
        args.push("--release");

        if (optimize) {
            // Wasm doesn't support unwind
            args.push("--config");
            args.push("profile.release.panic=\"abort\"");

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
                args.push("-Z", "build-std=panic_abort,std");
                args.push("-Z", "build-std-features=panic_immediate_abort,optimize_for_size");

                //args.push("--config");
                //args.push(`build.rustflags=["-Z", "location-detail=none", "-Z", "fmt-debug=none"]`);
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

    args = args.concat(extraArgs);

    /*args.push("--");

    if (this.options.multithreading) {
        args.push("-C", "target-feature=+atomics,+bulk-memory,+mutable-globals");
    }

    if (this.options.rustArgs) {
        args = args.concat(this.options.rustArgs);
    }*/

    await GLOBAL_LOCK.withLock(async () => {
        if (verbose) {
            debug(`Running cargo ${args.join(" ")}`);
        }

        await spawn(cargoBin, args, { cwd: dir, stdio: "inherit" });
    });
}

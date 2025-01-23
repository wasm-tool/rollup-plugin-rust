import * as $path from "node:path";
import * as $tar from "tar";
import $fetch from "node-fetch";
import { getVersion } from "./cargo.js";
import { exec, mkdir, getCacheDir, tar, exists, spawn, info, debug, getEnv } from "./utils.js";


const WASM_BINDGEN_CACHE = {};


function getName(version) {
    switch (process.platform) {
    case "win32":
        return `wasm-bindgen-${version}-x86_64-pc-windows-msvc`;
    case "darwin":
        switch (process.arch) {
        case "arm64":
            return `wasm-bindgen-${version}-aarch64-apple-darwin`;
        default:
            return `wasm-bindgen-${version}-x86_64-apple-darwin`;
        }
    default:
        switch (process.arch) {
        case "arm64":
            return `wasm-bindgen-${version}-aarch64-unknown-linux-gnu`;
        default:
            return `wasm-bindgen-${version}-x86_64-unknown-linux-musl`;
        }
    }
}


function getUrl(version, name) {
    return `https://github.com/rustwasm/wasm-bindgen/releases/download/${version}/${name}.tar.gz`;
}


function getPath(dir) {
    if (process.platform === "win32") {
        return $path.join(dir, "wasm-bindgen.exe");
    } else {
        return $path.join(dir, "wasm-bindgen");
    }
}


async function fetchBin(dir, version, name, path) {
    await mkdir(dir);

    if (!(await exists(path))) {
        info(`Downloading wasm-bindgen version ${version}`);

        const response = await $fetch(getUrl(version, name));

        if (!response.ok) {
            throw new Error(`Could not download wasm-bindgen: ${response.statusText}`);
        }

        await tar(response.body, {
            cwd: dir,
        });
    }
}


export async function download(dir, verbose) {
    const version = await getVersion(dir, "wasm-bindgen");
    const name = getName(version);

    const cache = getCacheDir("rollup-plugin-rust");

    const path = getPath($path.join(cache, name));

    if (verbose) {
        debug(`Searching for wasm-bindgen at ${path}`);
    }

    let promise = WASM_BINDGEN_CACHE[path];

    if (promise == null) {
        promise = WASM_BINDGEN_CACHE[path] = fetchBin(cache, version, name, path);
    }

    await promise;

    return path;
}


export async function run({ bin, dir, wasmPath, outDir, typescript, extraArgs, verbose }) {
    // TODO what about --debug --no-demangle --keep-debug ?
    let args = [
        "--out-dir", outDir,
        "--out-name", "index",
        "--target", "web",
        "--omit-default-module-path",
    ];

    if (!typescript) {
        args.push("--no-typescript");
    }

    args.push(wasmPath);

    args = args.concat(extraArgs);

    if (verbose) {
        debug(`Running wasm-bindgen ${args.join(" ")}`);
    }

    await spawn(bin, args, { cwd: dir, stdio: "inherit" });
}

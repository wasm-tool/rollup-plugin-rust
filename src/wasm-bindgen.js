const $path = require("path");
const $tar = require("tar");
const $fetch = require("node-fetch");
const { exec, mkdir, get_cache_dir, tar, exists, spawn, info, debug, getEnv } = require("./utils");


function wasm_bindgen_name(version) {
    switch (process.platform) {
    case "win32":
        return `wasm-bindgen-${version}-x86_64-pc-windows-msvc`;
    case "darwin":
        return `wasm-bindgen-${version}-x86_64-apple-darwin`;
    default:
  	switch (process.arch) {
	    case "arm64":
                return `wasm-bindgen-${version}-aarch64-unknown-linux-gnu`;
 	    default:
                return `wasm-bindgen-${version}-x86_64-unknown-linux-musl`;
	}
    }
}

function wasm_bindgen_url(version, name) {
    return `https://github.com/rustwasm/wasm-bindgen/releases/download/${version}/${name}.tar.gz`
}

function wasm_bindgen_path(dir) {
    if (process.platform === "win32") {
        return $path.join(dir, "wasm-bindgen.exe");
    } else {
        return $path.join(dir, "wasm-bindgen");
    }
}


const VERSION_REGEXP = /([\d\.]+)[\r\n]*$/;

async function wasm_bindgen_version(dir) {
    const cargo_exec = getEnv("CARGO_BIN", "cargo");
    const pkg_spec = await exec(`${cargo_exec} pkgid wasm-bindgen`, { cwd: dir });

    const version = VERSION_REGEXP.exec(pkg_spec);

    if (version) {
        return version[1];

    } else {
        throw new Error("Could not determine wasm-bindgen version");
    }
}


async function download_wasm_bindgen(url, dir) {
    const response = await $fetch(url);

    if (!response.ok) {
        throw new Error(`Could not download wasm-bindgen: ${response.statusText}`);
    }

    await tar(response.body, {
        cwd: dir,
    });
}


async function get_wasm_bindgen(dir, options) {
    const version = await wasm_bindgen_version(dir);
    const name = wasm_bindgen_name(version);

    const cache_dir = get_cache_dir("rollup-plugin-rust");
    await mkdir(cache_dir);

    const path = wasm_bindgen_path($path.join(cache_dir, name));

    if (options.verbose) {
        debug(`Searching for wasm-bindgen at ${path}`);
    }

    if (!(await exists(path))) {
        info(`Downloading wasm-bindgen version ${version}`);
        await download_wasm_bindgen(wasm_bindgen_url(version, name), cache_dir);
    }

    return path;
}


async function run_wasm_bindgen(dir, wasm_path, out_dir, options) {
    let wasm_bindgen_command = getEnv("WASM_BINDGEN_BIN", null);

    if (wasm_bindgen_command == null) {
        wasm_bindgen_command = await get_wasm_bindgen(dir, options);
    }

    // TODO what about --debug --no-demangle --keep-debug ?
    let wasm_bindgen_args = [
        "--out-dir", out_dir,
        "--out-name", "index",
        "--target", "web",
        "--no-typescript", // TODO make TypeScript work properly
        wasm_path,
    ];

    if (options.wasmBindgenArgs) {
        wasm_bindgen_args = wasm_bindgen_args.concat(options.wasmBindgenArgs);
    }

    if (options.verbose) {
        debug(`Running wasm-bindgen ${wasm_bindgen_args.join(" ")}`);
    }

    await spawn(wasm_bindgen_command, wasm_bindgen_args, { cwd: dir, stdio: "inherit" });
}

exports.run_wasm_bindgen = run_wasm_bindgen;

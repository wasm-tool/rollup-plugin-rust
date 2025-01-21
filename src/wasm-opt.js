import * as $path from "node:path";
import { getEnv, debug, spawn, mv } from "./utils.js";


// Replace with @webassemblyjs/wasm-opt ?
export async function run({ dir, input, output, extraArgs, verbose }) {
    // Needed to make wasm-opt work on Windows
    const bin = getEnv("WASM_OPT_BIN", (process.platform === "win32" ? "wasm-opt.cmd" : "wasm-opt"));
    const options = { cwd: dir, stdio: "inherit" };
    if (process.platform === "win32") {
        options.shell = true;
    }

    const args = [input, "--output", output].concat(extraArgs);

    if (verbose) {
        debug(`Running ${bin} ${args.join(" ")}`);
    }

    try {
        await spawn(bin, args, options);

    } catch (e) {
        return e;
    }

    await mv($path.join(dir, output), $path.join(dir, input));

    return null;
}

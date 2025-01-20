import rust from "../src/index.js";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

export default {
    input: {
        foo: "./src/foo.js",
        bar: "./src/bar.js",
        qux: "./src/foo/Cargo.toml",
    },
    output: {
        dir: "dist/js",
        format: "es",
        sourcemap: true,
    },
    plugins: [
        nodeResolve(),

        commonjs(),

        rust({
            extraArgs: {
                wasmBindgen: ["--debug", "--keep-debug"],
            },
            verbose: true,
        }),
    ],
};

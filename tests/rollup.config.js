const rust = require("..");
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
        rust({
            serverPath: "js/",
            wasmBindgenArgs: ["--debug", "--keep-debug"],
            verbose: true,
        }),

        nodeResolve(),

        commonjs(),
    ],
};

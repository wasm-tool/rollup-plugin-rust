import rust from "@wasm-tool/rollup-plugin-rust";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

export default {
    input: {
        foo: "./src/foo.js",
        bar: "./src/bar.js",
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
            serverPath: "js/",
        }),
    ],
};

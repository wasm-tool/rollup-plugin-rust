# rollup-plugin-rust

Rollup plugin for bundling and importing Rust crates.

This plugin internally uses [`wasm-pack`](https://rustwasm.github.io/wasm-pack/) and [`wasm-bindgen`](https://rustwasm.github.io/docs/wasm-bindgen/).

## Installation

First, make sure that [rustup](https://rustup.rs/) is installed.

If you are on Windows, then you also need to install the [Visual Studio build tools](https://visualstudio.microsoft.com/thank-you-downloading-visual-studio/?sku=BuildTools&rel=16) (make sure to enable the "C++ build tools" option).

Lastly, run this:

```sh
yarn add --dev @wasm-tool/rollup-plugin-rust
```

Or if you're using npm you can use this instead:

```sh
npm install --save-dev @wasm-tool/rollup-plugin-rust
```

## Usage

Add the plugin to your `rollup.config.js`, and now you can use `Cargo.toml` files as entries:

```js
import rust from "@wasm-tool/rollup-plugin-rust";

export default {
    input: {
        foo: "Cargo.toml",
    },
    plugins: [
        rust(),
    ],
};
```

You can import as many different `Cargo.toml` files as you want, each one will be compiled separately.

When compiling multiple crates it is recommended to use a single shared [workspace](https://doc.rust-lang.org/cargo/reference/manifest.html#the-workspace-section) to improve compile times.

### Importing `Cargo.toml` within `.js`

It is also possible to import a `Cargo.toml` file inside of a `.js` file, like this:

```js
import wasm from "./path/to/Cargo.toml";

async function loadWasm() {
    const exports = await wasm();

    // Use functions which were exported from Rust...
}
```

This will load the Rust `.js` glue code synchronously, but the Rust `.wasm` code will be loaded asynchronously (which is why the `wasm` function returns a `Promise`).

If you instead want to load *everything* asynchronously, you can use dynamic `import`, like this:

```js
async function loadWasm() {
    const wasm = await import("./path/to/Cargo.toml");
    const exports = await wasm.default();

    // Use functions which were exported from Rust...
}
```

## Options

These are the default options:

```js
rust({
    // Whether to build in debug mode or release mode.
    // In watch mode this defaults to true.
    debug: false,

    // Whether to display extra compilation information in the console.
    verbose: false,

    // Directory on your server where the .wasm files will be loaded from.
    // This is prepended to the URL, so you should put a / at the end of the directory, e.g. "/foo/".
    serverPath: "",

    // Directory (relative to output.dir) where the .wasm files will be placed.
    outDir: "",

    // Relates to "--out-name" flag of `wasm-pack`
    outName: "index",

    // Deployment target. It can be "bundler", "web", "nodejs", "deno", or "no-modules".
    target: "web",

    // Relates to "--mode" flag of `wasm-pack`. It can be `normal` or `no-install`.
    mode: "normal",

    // Extra arguments directly passed to `cargo build`. See https://rustwasm.github.io/wasm-pack/book/commands/build.html#extra-options.
    cargoArgs: [],

    // Whether to inline the `.wasm` file into the `.js` file.
    //
    // This is slower and it increases the file size by ~33%,
    // but it does not require a separate `.wasm` file.
    //
    // If this is `true` then `serverPath`, `outDir`, and
    // `importHook` will be ignored.
    inlineWasm: false,

    // Which files it should watch in watch mode. This is relative to the crate directory.
    // Supports all of the glob syntax.
    watchPatterns: ["src/**"],

    // Allows you to customize the behavior for loading the .wasm file, this is for advanced users only!
    importHook: function (path) { return JSON.stringify(path); },
})
```

The defaults are good for most use cases, so you generally shouldn't need to change them.

### Chrome / Firefox extensions

If you are creating a Chrome / Firefox extension you may need to use `importHook` to customize the loading behavior, like this:

```js
rust({
    importHook: function (path) {
        return "chrome.runtime.getURL(" + JSON.stringify(path) + ")";
    },
})
```

This is necessary because extension files are put into a separate URL namespace, so you must use `chrome.runtime.getURL` to get the correct URL.

# rollup-plugin-rust

Rollup plugin for bundling and importing Rust crates.

This plugin internally uses [`wasm-bindgen`](https://rustwasm.github.io/docs/wasm-bindgen/).

`wasm-bindgen` is automatically installed, you do not need to install it separately.

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

See the [example folder](tree/master/example) for a simple working example. First run `yarn install`, and then `yarn watch`.

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

### Customizing the import URL

At build time you can use the `serverPath` or `importHook` build options (described below) to customize the import URL for the `.wasm` file.

However, sometimes you need to customize the URL at runtime. In that case you can pass the `serverPath` or `importHook` options to the function (they behave the same as the build options):

```js
import wasm from "./path/to/Cargo.toml";

async function loadWasm() {
    const exports = await wasm({
        // This will replace the directory with `/foo/`
        serverPath: "/foo/",

        // This will prepend `/bar/` to the import URL.
        importHook: (path) => "/bar/" + path
    });

    // Use functions which were exported from Rust...
}
```

Usually you only need to pass one or the other, not both. Use `serverPath` for replacing the entire directory, and use `importHook` for prepending or doing more advanced things.

## Build options

The default options are good for most use cases, so you generally shouldn't need to change them.

These are the default options:

```js
rust({
    // Directory on your server where the .wasm files will be loaded from.
    // This is prepended to the URL, so you should put a / at the end of the directory,
    // for example "/foo/".
    serverPath: "",

    // Whether the code will be run in Node.js or not.
    //
    // This is needed because Node.js does not support `fetch`.
    nodejs: false,

    // Whether to build in debug mode or release mode.
    // In watch mode this defaults to true.
    debug: false,

    // Whether to display extra compilation information in the console.
    verbose: false,

    // Whether to inline the `.wasm` file into the `.js` file.
    //
    // This is slower and it increases the file size by ~33%,
    // but it does not require a separate `.wasm` file.
    //
    // If this is `true` then `serverPath`, `nodejs`,
    // and `importHook` will be ignored.
    inlineWasm: false,

    // Extra arguments passed to `cargo build`.
    cargoArgs: [],

    // Extra arguments passed to `wasm-bindgen`.
    wasmBindgenArgs: [],

    // Arguments passed to `wasm-opt`.
    wasmOptArgs: ["-O"],

    // Which files it should watch in watch mode. This is relative to the Cargo.toml file.
    // Supports all of the glob syntax: https://www.npmjs.com/package/glob
    watchPatterns: ["src/**"],

    // Allows you to customize the behavior for loading the .wasm file,
    // this is for advanced users only!
    importHook: function (path) { return JSON.stringify(path); },

    // These options should not be relied upon, they can change or disappear in future versions.
    experimental: {
        // Changes the way that the modules are generated. Normally you import Rust like this:
        //
        //     import wasm from "./path/to/Cargo.toml";
        //
        //     async function loadWasm() {
        //         const exports = await wasm();
        //
        //         // Use functions which were exported from Rust...
        //     }
        //
        // But now you import Rust like this:
        //
        //     import { foo, bar } from "./path/to/Cargo.toml";
        //
        //     // Use functions which were exported from Rust...
        //
        // You might need to set the Rollup `format` to "es" or "system".
        directExports: false,

        // Whether the Wasm will be initialized synchronously or not.
        //
        // In the browser you can only use synchronous loading inside of Workers.
        //
        // This requires `inlineWasm: true`.
        synchronous: false,
    },
})
```

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

### Environment variables

You can use the following environment variables to customize some aspects of this plugin:

* `CARGO_BIN` is the path to the `cargo` executable.
* `WASM_BINDGEN_BIN` is the path to the `wasm-bindgen` executable.
* `WASM_OPT_BIN` is the path to the `wasm-opt` executable.

If not specified, they will use a good default value, so you shouldn't need to change them, this is for advanced uses only.

# rollup-plugin-rust

Rollup plugin for bundling and importing Rust crates.

This plugin internally uses [`wasm-bindgen`](https://rustwasm.github.io/docs/wasm-bindgen/).

`wasm-bindgen` is automatically installed, you do not need to install it separately.


## Installation

First, make sure that [rustup](https://rustup.rs/) is installed.

If you are on Windows, then you also need to install the [Visual Studio build tools](https://visualstudio.microsoft.com/thank-you-downloading-visual-studio/?sku=BuildTools&rel=16) (make sure to enable the "C++ build tools" option).

Lastly, run this:

```sh
yarn add --dev @wasm-tool/rollup-plugin-rust binaryen
```

Or if you're using npm you can use this instead:

```sh
npm install --save-dev @wasm-tool/rollup-plugin-rust binaryen
```


## Usage

Add the plugin to your `rollup.config.js`, and now you can use `Cargo.toml` files as entries:

```js
import rust from "@wasm-tool/rollup-plugin-rust";

export default {
    format: "es",
    input: {
        foo: "Cargo.toml",
    },
    plugins: [
        rust(),
    ],
};
```

You can import as many different `Cargo.toml` files as you want, each one will be compiled separately.

See the [example folder](/example) for a simple working example. First run `yarn install`, and then `yarn watch` for development. Use `yarn build` to build for production.


### Importing `Cargo.toml` within `.js`

It is also possible to import a `Cargo.toml` file inside of a `.js` file, like this:

```js
import { foo, bar } from "./path/to/Cargo.toml";

// Use functions which were exported from Rust...
```

----

## Extra Tips


### Nightly

It is recommended to use the [nightly toolchain](https://rust-lang.github.io/rustup/overrides.html#the-toolchain-file) because it significantly reduces the size of the `.wasm` file.

You can use nightly by creating a `rust-toolchain.toml` file in your project directory:

```toml
[toolchain]
channel = "nightly-2025-11-20"
components = [ "rust-std", "rust-src", "rustfmt", "clippy" ]
targets = [ "wasm32-unknown-unknown" ]
```

You can change the `channel` to upgrade to the latest nightly version (or downgrade to a past nightly version).

After changing the `rust-toolchain.toml` file, you might need to run `rustup show` in order to download the correct Rust version.


### Workspaces

When compiling multiple crates it is highly recommended to use a [workspace](https://doc.rust-lang.org/cargo/reference/manifest.html#the-workspace-section) to improve compile times.

Create a `Cargo.toml` file in the root of your project which lists out the sub-crates that are a part of the workspace:

```toml
[workspace]
members = [
    "src/foo",
    "src/bar",
]
```


### Optimizing for size

By default the Rust compiler optimizes for maximum runtime performance, but this comes at the cost of a bigger file size.

On the web it is desirable to have a small file size, because a smaller `.wasm` file will download faster.

This plugin automatically optimizes for smaller file size, but you can reduce the size even further by adding this into your `Cargo.toml`:

```toml
[profile.release]
opt-level = "z"
```

You can also try `opt-level = "s"` which in some cases might produce a smaller file size.

If you're using workspaces, make sure to add that into your *workspace* `Cargo.toml`, not the sub-crates.


### Usage with Vite

This plugin works out of the box with Vite, however Vite has SSR, which means that it runs your code on both the server and browser.

This can cause errors when loading Wasm files, so you need to disable SSR when loading the Wasm:

```js
async function loadWasm() {
    // This code will only run in the browser
    if (!import.meta.env.SSR) {
        const { foo, bar } = await import("./path/to/Cargo.toml");

        // Use functions which were exported from Rust...
    }
}
```


### Customizing the Wasm loading

For very advanced use cases, you might want to manually initialize the `.wasm` code.

If you add `?custom` when importing a `Cargo.toml` file, it will give you:

* `module` which is the `URL` of the `.wasm` file, or a `Uint8Array` if using `inlineWasm: true`.

* `init` which is a function that initializes the Wasm and returns a Promise. The `init` function accepts these options:

   * `module` which is a `URL` or `Uint8Array` or `WebAssembly.Module` for the `.wasm` code.
   * `memory` which is a `WebAssembly.Memory` that will be used as the memory for the Wasm.

```js
import { module, init } from "./path/to/Cargo.toml?custom";

async function loadWasm() {
    const { foo, bar } = await init({
        // The URL or Uint8Array which will be initialized.
        module: module,

        // The WebAssembly.Memory which will be used for the Wasm.
        //
        // If this is undefined then it will automatically create a new memory.
        //
        // This is useful for doing multi-threading with multiple Workers sharing the same SharedArrayBuffer.
        memory: undefined,
    });

    // Use functions which were exported from Rust...
}
```

----

## Build options

The default options are good for most use cases, so you generally shouldn't need to change them.

These are the default options:

```js
rust({
    // Whether the code will be run in Node.js or not.
    //
    // This is needed because Node.js does not support `fetch`.
    nodejs: false,

    // Whether to inline the `.wasm` file into the `.js` file.
    //
    // This is slower and it increases the file size by ~33%,
    // but it does not require a separate `.wasm` file.
    inlineWasm: false,

    // Whether to display extra compilation information in the console.
    verbose: false,

    extraArgs: {
        // Extra arguments passed to `cargo`.
        cargo: [],

        // Extra arguments passed to `rustc`, this is equivalent to `RUSTFLAGS`.
        rustc: [],

        // Extra arguments passed to `wasm-bindgen`.
        wasmBindgen: [],

        // Extra arguments passed to `wasm-opt`.
        wasmOpt: ["-O", "--enable-threads", "--enable-bulk-memory", "--enable-bulk-memory-opt"],
    },

    optimize: {
        // Whether to build in release mode.
        //
        // In watch mode this defaults to false.
        release: true,

        // Whether to run wasm-opt.
        //
        // In watch mode this defaults to false.
        wasmOpt: true,

        // Whether to use optimized rustc settings.
        //
        // This slows down compilation but significantly reduces the file size.
        //
        // If you use the nightly toolchain, this will reduce the file size even more.
        rustc: true,

        // These options default to false in watch mode.
        strip: {
            // Removes location information, resulting in lower file size but worse stace traces.
            // Currently this only works on nightly.
            location: true,

            // Removes debug formatting from strings, such as `format!("{:?}", ...)`
            // Currently this only works on nightly.
            formatDebug: true,
        },
    },

    // Which files it should watch in watch mode. This is relative to the Cargo.toml file.
    // Supports all of the glob syntax: https://www.npmjs.com/package/glob
    watchPatterns: ["src/**"],

    // These options should not be relied upon, they can change or disappear in future versions.
    experimental: {
        // Compiles with atomics and enables multi-threading.
        // Currently this only works on nightly.
        atomics: false,

        // Whether the Wasm will be initialized synchronously or not.
        //
        // In the browser you can only use synchronous loading inside of Workers.
        //
        // This requires `inlineWasm: true`.
        synchronous: false,

        // Creates a `.d.ts` file for each `Cargo.toml` crate and places them
        // into this directory.
        //
        // This is useful for libraries which want to export TypeScript types.
        typescriptDeclarationDir: null,
    },
})
```


### Environment variables

You can use the following environment variables to customize some aspects of this plugin:

* `CARGO_BIN` is the path to the `cargo` executable.
* `WASM_BINDGEN_BIN` is the path to the `wasm-bindgen` executable.
* `WASM_OPT_BIN` is the path to the `wasm-opt` executable.

If not specified, they will use a good default value, so you shouldn't need to change them, this is for advanced uses only.

# rust-plugin-rust

> Rollup plugin for bundling or importing Rust crates

## Installation

```sh
yarn add --dev wasm-pack
yarn add --dev github:Pauan/rollup-plugin-rust
```

### `wasm-pack`

This plugin internally uses [`wasm-pack`](https://rustwasm.github.io/wasm-pack/) and [`wasm-bindgen`](https://rustwasm.github.io/docs/wasm-bindgen/), which is why you must install the `wasm-pack` npm package in order for it to work.

## Usage

Add the plugin in your `rollup.config.js` and import a `Cargo.toml` file:

```js
import rust from "rollup-plugin-rust";

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

## Options

These are the default options:

```js
rust({
    // Whether to build in debug mode or release mode.
    // In watch mode this defaults to true.
    debug: false,

    // Directory (relative to output.dir) where the .wasm files should be placed.
    outdir: "",

    // Which files it should watch in watch mode. Supports all of the glob syntax.
    watchPatterns: ["src/**"],

    // Lets you customize the behavior for loading the .wasm file, this is for advanced users only!
    importHook: function (path) { return JSON.stringify(path); },
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

This is necessary because extension files are put into a separate URL namespace, so you must use `chrome.runtime.getURL` to find the correct URL.

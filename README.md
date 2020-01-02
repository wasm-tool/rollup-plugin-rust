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

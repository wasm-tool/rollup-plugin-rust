import * as foo1 from "./foo/Cargo.toml?custom";
import * as foo2 from "./foo/Cargo.toml?custom";

await foo1.init({ module: foo1.module });
await foo2.init({ module: foo2.module });

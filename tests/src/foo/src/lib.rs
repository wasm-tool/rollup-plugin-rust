use wasm_bindgen::prelude::*;
use web_sys::console;


#[wasm_bindgen(module = "nop")]
extern "C" {
    fn nop();
}


#[wasm_bindgen(start)]
pub fn main_js() {
    console_error_panic_hook::set_once();

    console::log_1(&JsValue::from(format!("Foo! {:?}", nop())));
}

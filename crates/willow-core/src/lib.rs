#[macro_use]
extern crate napi_derive;

mod error;
mod model;
mod napi_exports;
mod search;
mod storage;
mod store;
pub mod vcs;

use std::sync::Once;

static TRACING_INIT: Once = Once::new();

pub fn init_tracing() {
    TRACING_INIT.call_once(|| {
        let filter = tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("willow_core=info"));
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_writer(std::io::stderr)
            .with_target(true)
            .init();
    });
}

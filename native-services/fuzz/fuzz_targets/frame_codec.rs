#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| fuzz_harness::frame_codec(data));

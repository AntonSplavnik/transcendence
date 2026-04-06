// Build script — compiles C++ game core via CXX bridge

fn main() {
    let game_core_path = "../game-core";
    let profile = std::env::var("PROFILE").unwrap_or_default();
    let is_release = profile == "release";

    let mut build = cxx_build::bridge("src/game/ffi.rs");
    build
        .file(format!("{game_core_path}/src/cxx_bridge.cpp"))
        .compiler("clang++")  // resolved from PATH; must be Clang, not g++
        .flag("-std=c++20")
        .include(format!("{game_core_path}/src"))
        .include(game_core_path)   // makes `entt/entt.hpp` resolvable
        .opt_level(3)                // always: C++ benefits regardless of Rust profile
        .flag("-march=x86-64-v3");  // always: AVX2/FMA on Haswell+(2013)/Zen+(2017)

    if is_release {
        build
            .flag("-flto=thin")  // cross-language LTO; pointless without Rust emitting bitcode
            .flag("-DNDEBUG");   // disables C++ assert()
    } else {
        build.flag("-g3");       // full DWARF debug info including macro definitions; zero runtime cost
    }

    build.compile("game");

    // Rebuild triggers
    println!("cargo:rerun-if-changed=src/game/ffi.rs");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../game-core/src");       // all headers and sources
    println!("cargo:rerun-if-changed=../game-core/entt/entt.hpp"); // single-include EnTT header
}

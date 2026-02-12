// Build script to compile C++ game engine

use std::env;
use std::path::PathBuf;

fn main() {
    // Path to game engine
    let game_engine_path = "../game_engine";

    println!("cargo:rerun-if-changed={}/src/game_bindings.cpp", game_engine_path);
    println!("cargo:rerun-if-changed={}/include/", game_engine_path);

    // Compile C++ code
    cc::Build::new()
        .cpp(true)
        .file(format!("{}/src/game_bindings.cpp", game_engine_path))
        .include(format!("{}/include", game_engine_path))
        .include(format!("{}/external/entt/src", game_engine_path))
        .flag("-std=c++20")  // EnTT requires C++20
        .opt_level(3) // Optimize for release
        .compile("game");

    // Note: cc crate handles C++ stdlib linking automatically (libc++ on macOS, libstdc++ on Linux)

    // Tell cargo to invalidate the built crate whenever the C++ files change
    println!("cargo:rerun-if-changed={}", game_engine_path);
}

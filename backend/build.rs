// Build script — compiles C++ game core via CXX bridge

fn main() {
    let game_core_path = "../game-core";
    let profile = std::env::var("PROFILE").unwrap_or_default();
    let is_release = profile == "release";

    let mut build = cxx_build::bridge("src/game/ffi.rs");

    // cxx 1.0.194 bug: rust::Slice::iterator has `pointer = T*` but is missing
    // `element_type = T`. Apple's libc++ pointer_traits strictly requires element_type
    // to evaluate contiguous_iterator, causing two static_asserts in cxx.h to fail.
    // cxx_build writes cxx.h to OUT_DIR during bridge(), so we patch it here before compile().
    // Remove when dtolnay/cxx fixes the iterator to include element_type.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let out_dir = std::env::var("OUT_DIR").unwrap();
        let cxx_h = format!("{out_dir}/cxxbridge/include/rust/cxx.h");
        if let Ok(content) = std::fs::read_to_string(&cxx_h) {
            // Add missing element_type typedef so Apple's pointer_traits can derive
            // element_type for Slice::iterator (required for contiguous_iterator concept).
            let patched = content.replace(
                "  using pointer = typename std::add_pointer<T>::type;\n  using reference",
                "  using pointer = typename std::add_pointer<T>::type;\n  using element_type = value_type;\n  using reference",
            );
            if patched != content {
                std::fs::write(&cxx_h, patched).unwrap();
            }
        }
    }

    build
        .file(format!("{game_core_path}/src/cxx_bridge.cpp"))
        .compiler("clang++") // resolved from PATH; must be Clang, not g++
        .flag("-std=c++20")
        .include(format!("{game_core_path}/src"))
        .include(game_core_path) // makes `entt/entt.hpp` resolvable
        .opt_level(3); // always: C++ benefits regardless of Rust profile

    // x86-64-v3 targets AVX2/FMA (Haswell+ 2013 / Zen+ 2017); not available on ARM
    if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("x86_64") {
        build.flag("-march=x86-64-v3");
    }

    // Warning flags — always on; -Werror will be added later (debug-only when it comes)
    for flag in &[
        "-Wall",
        "-Wextra",
        "-Wpedantic",
        "-Wshadow",           // local name hides outer scope (e.g. registry vs m_registry)
        "-Wnon-virtual-dtor", // deleting through base ptr without virtual dtor → UB
        "-Woverloaded-virtual",
        "-Wimplicit-fallthrough", // missing break in switch; use [[fallthrough]] for intentional ones
        "-Wswitch-enum",          // every enumerator must be handled even when default exists
        "-Wundef",                // #if UNDEFINED_MACRO silently becomes 0
        "-Wconversion",           // implicit narrowing (e.g. double → float, int → short)
        "-Wsign-conversion",      // signed/unsigned mismatch
        "-Wdouble-promotion", // float silently promoted to double (e.g. std::sin(f) vs std::sinf(f))
        "-Wold-style-cast",   // enforce static_cast/reinterpret_cast discipline everywhere
        "-Wcast-align",       // misaligned reinterpret_cast → UB on strict-alignment archs
        "-Wfloat-equal",      // == / != on floats; use epsilon comparison in physics code
    ] {
        build.flag(flag);
    }

    if is_release {
        build
            .flag("-flto=thin") // cross-language LTO; pointless without Rust emitting bitcode
            .flag("-DNDEBUG"); // disables C++ assert()
    } else {
        build.flag("-g3"); // full DWARF debug info including macro definitions; zero runtime cost
    }

    build.compile("game");

    // Rebuild triggers
    println!("cargo:rerun-if-changed=src/game/ffi.rs");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../game-core/src"); // all headers and sources
    println!("cargo:rerun-if-changed=../game-core/entt/entt.hpp"); // single-include EnTT header
    println!("cargo:rerun-if-changed=../game-core/nlohmann/json.hpp"); // single-include JSON library
    println!("cargo:rerun-if-changed=../game-core/assets/map.json"); // unified map data
    println!("cargo:rerun-if-changed=../game-core/assets/presets"); // character preset JSONs
}

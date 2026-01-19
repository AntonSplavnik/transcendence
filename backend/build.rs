use std::path::Path;

fn main() {
    println!("cargo:rerun-if-env-changed=CPP_LIBS");
    println!("cargo:rerun-if-changed=src/game_ffi.rs");

    let mut build = cxx_build::bridge("src/game_ffi.rs");
    build.std("c++20");
    build.include("game/include");

    let cpp_src_dir = Path::new("game/src");
    if cpp_src_dir.exists() {
        let mut files = Vec::new();
        for entry in walkdir::WalkDir::new(cpp_src_dir)
            .into_iter()
            .filter_map(Result::ok)
        {
            let path = entry.path();
            if path.is_file() {
                let ext =
                    path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if matches!(ext, "cc" | "cpp" | "cxx") {
                    files.push(path.to_owned());
                    println!("cargo:rerun-if-changed={}", path.display());
                }
            }
        }
        build.files(files);
    }

    let include_dir = Path::new("game/include");
    if include_dir.exists() {
        for entry in walkdir::WalkDir::new(include_dir)
            .into_iter()
            .filter_map(Result::ok)
        {
            let path = entry.path();
            if path.is_file() {
                println!("cargo:rerun-if-changed={}", path.display());
            }
        }
    }

    if let Ok(libs) = std::env::var("CPP_LIBS") {
        for lib in libs.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
            pkg_config::Config::new().probe(lib).unwrap_or_else(|err| {
                panic!("Failed to find pkg-config lib '{lib}': {err}");
            });
        }
    }

    build.compile("transcendence_cpp");
}

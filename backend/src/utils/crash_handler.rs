/// Installs signal handlers for SIGSEGV, SIGABRT, and SIGBUS that print a
/// backtrace to stderr before re-raising the signal for the default action.
///
/// This is specifically designed to diagnose crashes originating in the C++
/// game engine (via CXX FFI), which produce signals that bypass Rust's
/// `catch_unwind`.
///
/// Must be called once, early in `main()`, before spawning any threads.
/// The handler uses `backtrace` / `backtrace_symbols_fd` from glibc, which
/// are async-signal-safe on Linux.  On non-glibc systems the handler still
/// prints the signal name but skips the backtrace.
#[cfg(unix)]
pub fn install() {
    unsafe {
        let mut sa: libc::sigaction = std::mem::zeroed();
        sa.sa_sigaction = handler as usize;
        sa.sa_flags = libc::SA_SIGINFO;
        libc::sigemptyset(&mut sa.sa_mask);

        libc::sigaction(libc::SIGSEGV, &sa, std::ptr::null_mut());
        libc::sigaction(libc::SIGABRT, &sa, std::ptr::null_mut());
        libc::sigaction(libc::SIGBUS, &sa, std::ptr::null_mut());
    }
}

#[cfg(not(unix))]
pub fn install() {}

// ── Signal handler (async-signal-safe only) ──────────────────────────────────

#[cfg(unix)]
extern "C" fn handler(sig: libc::c_int, _info: *mut libc::siginfo_t, _ctx: *mut libc::c_void) {
    let label: &[u8] = match sig {
        libc::SIGSEGV => b"\n=== CRASH: SIGSEGV (segmentation fault) ===\n",
        libc::SIGABRT => b"\n=== CRASH: SIGABRT (abort) ===\n",
        libc::SIGBUS => b"\n=== CRASH: SIGBUS (bus error) ===\n",
        _ => b"\n=== CRASH: unknown fatal signal ===\n",
    };

    unsafe {
        libc::write(libc::STDERR_FILENO, label.as_ptr().cast(), label.len());
    }

    write_backtrace();

    unsafe {
        let footer = b"=== Re-raising signal for default handler (core dump) ===\n\n";
        libc::write(libc::STDERR_FILENO, footer.as_ptr().cast(), footer.len());

        // Restore default handler and re-raise so the OS generates a core dump
        // and the exit code still reflects the signal.
        libc::signal(sig, libc::SIG_DFL);
        libc::raise(sig);
    }
}

// ── Backtrace capture ────────────────────────────────────────────────────────
//
// glibc exposes `backtrace` and `backtrace_symbols_fd` which are
// async-signal-safe.  We link them dynamically so the build still succeeds
// on musl (where they are absent) — we just skip the backtrace.

#[cfg(unix)]
fn write_backtrace() {
    type BacktraceFn = unsafe extern "C" fn(*mut *mut libc::c_void, libc::c_int) -> libc::c_int;
    type SymbolsFdFn =
        unsafe extern "C" fn(*const *mut libc::c_void, libc::c_int, libc::c_int);

    // Try to resolve the glibc backtrace functions at runtime.
    let (bt, bt_fd) = unsafe {
        (
            libc::dlsym(libc::RTLD_DEFAULT, b"backtrace\0".as_ptr().cast()),
            libc::dlsym(
                libc::RTLD_DEFAULT,
                b"backtrace_symbols_fd\0".as_ptr().cast(),
            ),
        )
    };

    if bt.is_null() || bt_fd.is_null() {
        unsafe {
            let msg = b"(backtrace unavailable on this libc)\n";
            libc::write(libc::STDERR_FILENO, msg.as_ptr().cast(), msg.len());
        }
        return;
    }

    let backtrace_fn: BacktraceFn = unsafe { std::mem::transmute(bt) };
    let symbols_fd_fn: SymbolsFdFn = unsafe { std::mem::transmute(bt_fd) };

    let mut buf: [*mut libc::c_void; 128] = [std::ptr::null_mut(); 128];
    let depth = unsafe { backtrace_fn(buf.as_mut_ptr(), 128) };
    if depth > 0 {
        unsafe { symbols_fd_fn(buf.as_ptr(), depth, libc::STDERR_FILENO) };
    }
}

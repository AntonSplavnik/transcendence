# Unsafe Code and FFI

Every `unsafe` block is a contract: "I, the programmer, guarantee conditions the
compiler cannot verify." In mission-critical code, this contract must be documented,
minimized, and encapsulated so callers never need to uphold it.

---

## `unsafe` Blocks

### The `// SAFETY:` Comment

Every `unsafe {}` block must have a `// SAFETY:` comment explaining **why the
invariant holds at this specific call site** -- not repeating the function's
`# Safety` docs, but proving they are satisfied here.

```rust
// SAFETY: `ptr` was obtained from `Box::into_raw` in `Self::new`, which
// guarantees it is non-null and aligned for `T`. No other code has access
// to this pointer (private field), so no aliasing can occur.
let value = unsafe { Box::from_raw(self.ptr) };
```

### Minimize `unsafe` Surface

Put the minimum amount of code inside each `unsafe` block. Perform all
validations and computations outside, then enter `unsafe` only for the
operation that requires it.

```rust
// BAD: entire function body in unsafe
unsafe {
    let len = compute_length(data);
    let ptr = data.as_ptr();
    let slice = std::slice::from_raw_parts(ptr, len);
    process(slice);
}

// GOOD: only the unsafe operation is inside the block
let len = compute_length(data);
let ptr = data.as_ptr();
// SAFETY: `ptr` is valid for `len` elements because `data` is a live
// slice of at least `len` elements (verified by compute_length).
let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
process(slice);
```

---

## `unsafe fn`

Every `unsafe fn` must have a `# Safety` doc section enumerating the exact
preconditions the caller must uphold.

```rust
/// Reinterprets the byte slice as a `Header`.
///
/// # Safety
///
/// - `bytes.len()` must equal `size_of::<Header>()`.
/// - `bytes` must be aligned to `align_of::<Header>()`.
/// - The bytes must represent a valid, initialized `Header` with all
///   fields in their valid ranges.
/// - The caller must ensure `bytes` outlives the returned reference.
pub unsafe fn header_from_bytes(bytes: &[u8]) -> &Header {
    // SAFETY: caller guarantees alignment, length, validity, and lifetime.
    &*(bytes.as_ptr() as *const Header)
}
```

### `unsafe impl`

Manual `Send`/`Sync` implementations require a `# Safety` section proving soundness:

```rust
/// # Safety
///
/// `RawHandle` contains a pointer that is exclusively owned by this struct
/// and never aliased. All access is through `&self` (read-only) or `&mut self`
/// (exclusive). No interior mutability is exposed through shared references.
unsafe impl Send for RawHandle {}
unsafe impl Sync for RawHandle {}
```

---

## FFI Fundamentals

### `extern "C"` Functions

Functions exposed to or called from C must use C-compatible types only.
No `String`, `Vec`, `Result`, or any Rust-specific type across the boundary.

```rust
/// # Safety
///
/// - `name_ptr` must be a valid, non-null, null-terminated C string.
/// - The string must remain valid for the duration of this call.
#[no_mangle]
pub unsafe extern "C" fn greet(name_ptr: *const c_char) -> i32 {
    // Catch any panic -- unwinding across FFI is undefined behavior.
    let result = std::panic::catch_unwind(|| {
        // SAFETY: caller guarantees name_ptr is valid and null-terminated.
        let name = unsafe { CStr::from_ptr(name_ptr) };
        let name_str = match name.to_str() {
            Ok(s) => s,
            Err(_) => return ERR_INVALID_UTF8,
        };
        println!("Hello, {name_str}!");
        SUCCESS
    });
    result.unwrap_or(ERR_PANIC)
}

const SUCCESS: i32 = 0;
const ERR_INVALID_UTF8: i32 = -1;
const ERR_PANIC: i32 = -99;
```

### `#[repr(C)]` for Struct Layout

Any struct passed across FFI must use `#[repr(C)]` for predictable layout.
Use `#[repr(transparent)]` for single-field newtypes used in FFI.

```rust
#[repr(C)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[repr(transparent)]
pub struct Handle(u64);
```

### String Handling

```rust
// Borrowing a C string (no allocation):
let c_str = unsafe { CStr::from_ptr(ptr) };  // borrows from C
let rust_str: &str = c_str.to_str()?;          // validates UTF-8

// Creating a C string to pass to C:
let c_string = CString::new(rust_string)
    .expect("rust_string contains no interior null bytes (validated at input boundary)");
let ptr: *const c_char = c_string.as_ptr();
// WARNING: c_string must outlive ptr. Do not drop c_string while C holds ptr.
```

C strings can contain arbitrary bytes — assuming UTF-8 and using unchecked conversion
is undefined behavior if the assumption is wrong. Use `to_str()` which returns `Result`
and lets you handle invalid encoding gracefully.

### Null Pointer Handling

Convert raw pointers to `Option` at the boundary immediately:

```rust
/// # Safety
/// `ptr` may be null (returns `None`) but if non-null must point to a valid `Config`.
pub unsafe fn config_from_ptr(ptr: *const Config) -> Option<&Config> {
    // SAFETY: NonNull check + caller guarantees validity of non-null pointer.
    NonNull::new(ptr as *mut Config).map(|nn| unsafe { nn.as_ref() })
}
```

### Opaque Handles

Transfer ownership across FFI with `Box::into_raw` / `Box::from_raw`.
Always provide explicit `_free` / `_destroy` functions.

```rust
/// Creates a new engine. Caller must call `engine_destroy` when done.
#[no_mangle]
pub extern "C" fn engine_create(config: *const Config) -> *mut Engine {
    let config = unsafe { &*config };  // validated by caller
    let engine = Box::new(Engine::new(config));
    Box::into_raw(engine)
}

/// Frees an engine created by `engine_create`.
///
/// # Safety
/// `ptr` must have been returned by `engine_create` and not previously freed.
#[no_mangle]
pub unsafe extern "C" fn engine_destroy(ptr: *mut Engine) {
    if !ptr.is_null() {
        // SAFETY: ptr was created by Box::into_raw in engine_create,
        // caller guarantees it has not been freed.
        drop(unsafe { Box::from_raw(ptr) });
    }
}
```

### Error Codes at FFI Boundary

Never use `Result` across FFI. Define C-style error enums or integer codes:

```rust
#[repr(C)]
pub enum FfiError {
    Success = 0,
    InvalidArgument = 1,
    IoError = 2,
    InternalPanic = 99,
}
```

For functions that return data, use out-parameters:

```rust
/// Writes the result into `out_value`. Returns an error code.
///
/// # Safety
/// `out_value` must be a valid, non-null, aligned pointer to `u64`.
#[no_mangle]
pub unsafe extern "C" fn compute(input: u32, out_value: *mut u64) -> FfiError {
    if out_value.is_null() { return FfiError::InvalidArgument; }
    let result = std::panic::catch_unwind(|| do_compute(input));
    match result {
        Ok(Ok(val)) => { unsafe { out_value.write(val) }; FfiError::Success }
        Ok(Err(_)) => FfiError::IoError,
        Err(_) => FfiError::InternalPanic,
    }
}
```

---

## Critical FFI Rules

1. **Never panic across FFI.** Wrap every `extern "C"` function body in
   `catch_unwind`. Unwinding across an FFI boundary is undefined behavior.
2. **Lifetimes cannot cross FFI.** If C borrows Rust data, the Rust side must
   guarantee the data outlives the borrow. Document this explicitly.
3. **`CString` must outlive the pointer.** `.as_ptr()` borrows from the `CString` —
   if the `CString` is dropped while C still holds the pointer, C reads freed memory.
   This is a common and subtle bug because the compiler cannot track lifetimes across FFI.
4. **No `#[repr(Rust)]` across FFI.** Rust's default struct layout is unspecified
   and can change between compiler versions.

---

## What Always Requires Documentation

- Every `unsafe` block: `// SAFETY:` comment
- Every `unsafe fn`: `# Safety` doc section
- Every `unsafe impl`: `# Safety` doc section
- Every `#[allow(...)]` attribute: comment explaining why the lint is wrong here
- Every `let _ = expr` discarding a `Result` or `JoinHandle`: comment why
- Every `expect()` call: message explaining the invariant

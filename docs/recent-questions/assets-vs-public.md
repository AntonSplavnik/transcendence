# `src/assets/` vs `public/`

## The core difference

**Compile time** — when you run `npm run build`, Vite reads all `import` statements and
builds a dependency graph. Files imported this way get processed, content-hashed, and
copied into the build output automatically.

**Runtime** — when the browser runs the app. Files in `public/` are served as-is at a
fixed URL. Vite never touches them. The browser fetches them only when the code asks for
them by URL.

---

## `src/assets/` — compile time

Use for files that are **imported directly in code**.

```typescript
import generalModel from '@/assets/Rig_Medium/Rig_Medium_General.glb';
import clickSound  from '@/assets/sounds/click.mp3';
```

Vite:
- Sees the file at build time
- Copies it to the output with a content hash: `Rig_Medium_General.a3f9c2.glb`
- Replaces the import with the final hashed URL
- Cache-busting is automatic — if the file changes, the hash changes

If the file has no `import` statement pointing to it, Vite will **not** include it in the
build. It simply disappears.

---

## `public/` — runtime

Use for files that are **loaded by URL string** at runtime.

```typescript
SceneLoader.Append('/scenes/', 'arena.babylon', scene, ...);
new Audio('/sounds/ambient_forest.mp3').play();
fetch('/maps/' + mapName + '.json');
```

Vite never sees these. The browser fetches them on demand when those lines execute.
Files in `public/` are copied to the build output as-is, at the same path, with no
hashing.

---

## Rule of thumb

| Question | Answer |
|---|---|
| Is the filename hardcoded in an `import`? | `src/assets/` |
| Is it passed as a URL string to a loader? | `public/` |
| Is it only loaded sometimes (level-specific, on demand)? | `public/` |
| Does it reference other files internally (`.babylon` → binary blobs)? | `public/` |
| Is it always needed and always loaded? | Either works, `src/assets/` preferred |

---

## Examples for this project

| Asset | Where | Why |
|---|---|---|
| Character GLB models | `src/assets/` | Imported directly, always loaded |
| Character animation GLBs | `src/assets/` | Imported directly, always loaded |
| Arena `.babylon` scene | `public/` | Loaded by `SceneLoader` with a URL string, references binary blobs internally |
| UI icons, logos | `src/assets/` | Imported in components |
| Short UI sounds (click, button) | `src/assets/` | Small, always needed |
| Large ambient music | `public/` | Too large to bundle, streamed on demand |
| Level-specific maps | `public/` | Only loaded when that level is selected |
| Maps loaded by name from server | `public/` | URL only known at runtime |

---

## Edge case — large files in `src/assets/`

Character GLBs are large. Importing them from `src/assets/` is correct but means Vite
includes them in the build analysis. If build times become slow, they can be moved to
`public/` and loaded by URL instead — no real downside for assets that are always loaded
regardless.

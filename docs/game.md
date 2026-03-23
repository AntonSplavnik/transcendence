## Babylon inspector

Babylon Inspector (scene.debugLayer) is an in-app debug UI that lets you inspect the scene graph, materials, cameras, and tweak properties live. We added a button to open it. This is quick and handy.

## The Babylon Editor

Opening the Babylon Editor (local) If you want the full Editor locally:

-Clone: git clone <https://github.com/BabylonJS/Editor.git>
-Follow its README to install deps and run (it’s a separate app — may require Node + npm or yarn).
-The Editor expects to be used as a separate tool; it’s not an embedded library.

Or

Use the online Sandbox & Editor: <https://sandbox.babylonjs.com/> and <https://editor.babylonjs.com/> — great for prototyping and viewing .babylon/.gltf models.

## models

to get glb models from gltf files, you can use npm:
go into the folder where you have the gltf file and run:
```
npx @gltf-transform/cli copy sword_1handed.gltf sword_1handed.glb
```

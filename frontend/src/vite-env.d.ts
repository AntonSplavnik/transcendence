/// <reference types="vite/client" />

// Declare GLB/GLTF file imports
declare module '*.glb' {
	const src: string;
	export default src;
}

declare module '*.gltf' {
	const src: string;
	export default src;
}

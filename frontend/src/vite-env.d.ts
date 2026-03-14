/// <reference types="vite/client" />

// Declare GLB file imports
declare module '*.glb' {
	const src: string;
	export default src;
}

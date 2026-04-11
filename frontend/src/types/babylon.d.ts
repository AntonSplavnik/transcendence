declare global {
	var BABYLON: typeof import('@babylonjs/core') & {
		GUI: typeof import('@babylonjs/gui');
	};
}

export {};

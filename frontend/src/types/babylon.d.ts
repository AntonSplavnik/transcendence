import type * as BabylonCore from '@babylonjs/core';
import type * as BabylonGUI from '@babylonjs/gui';

declare global {
	const BABYLON: typeof BabylonCore & { GUI: typeof BabylonGUI };
}

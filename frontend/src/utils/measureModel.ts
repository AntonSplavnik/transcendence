import { Engine, Scene, SceneLoader, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

/**
 * Measures the bounding box dimensions of a GLB model
 * Returns height, width, depth in units
 */
export async function measureModel(modelPath: string): Promise<{
    height: number;
    width: number;
    depth: number;
    min: Vector3;
    max: Vector3;
}> {
    // Create temporary canvas
    const canvas = document.createElement('canvas');
    const engine = new Engine(canvas, false);
    const scene = new Scene(engine);

    // Load model
    const result = await SceneLoader.ImportMeshAsync("", "", modelPath, scene);

    // Calculate bounding box
    let min = new Vector3(Infinity, Infinity, Infinity);
    let max = new Vector3(-Infinity, -Infinity, -Infinity);

    result.meshes.forEach(mesh => {
        const boundingInfo = mesh.getBoundingInfo();
        const meshMin = boundingInfo.boundingBox.minimumWorld;
        const meshMax = boundingInfo.boundingBox.maximumWorld;

        min = Vector3.Minimize(min, meshMin);
        max = Vector3.Maximize(max, meshMax);
    });

    const width = max.x - min.x;
    const height = max.y - min.y;
    const depth = max.z - min.z;

    // Cleanup
    scene.dispose();
    engine.dispose();
    canvas.remove();

    return { height, width, depth, min, max };
}

// Usage example:
// const dimensions = await measureModel(generalModel);
// console.log(`Character height: ${dimensions.height.toFixed(2)} units`);

import { useEffect, useRef } from "react";
import { Engine, Scene, FreeCamera, HemisphericLight, MeshBuilder, Vector3 } from "@babylonjs/core";

export default function SceneComponent() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      const engine = new Engine(canvasRef.current, true);
      const scene = new Scene(engine);

      // Basic setup
      const camera = new FreeCamera("camera", new Vector3(0, 1, -5), scene);
      camera.attachControl(canvasRef.current, true);
      new HemisphericLight("light", new Vector3(0, 1, 0), scene);
      MeshBuilder.CreateBox("box", { size: 1 }, scene);

      engine.runRenderLoop(() => scene.render());
    }
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "400px" }} />;
}

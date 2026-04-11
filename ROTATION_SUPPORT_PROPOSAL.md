# Collision Rotation Support Proposal

## Problem
Current map has **rotated obstacles** (e.g., forest_zone_1 at ~45°), but collision boxes can't rotate.

**Current situation:**
- All box colliders are axis-aligned (AABB)
- Rotated zones are converted to cylinders (which work but over-cover)

## Solution: Add rotation parameter to Box colliders

### 1. Modify `Collider.hpp`

Add a `rotation` field to store rotation angle:

```cpp
struct Collider {
    // ... existing fields ...
    
    // Rotation (for Box colliders)
    float rotationY = 0.0f;  // Rotation around Y-axis in radians (0 = no rotation)
    
    // Helper to create rotated box
    static Collider createBox(
        float width, float height, float depth, 
        float rotationY = 0.0f
    ) {
        Collider collider;
        collider.shape = Shape::Box;
        collider.halfExtents = Vector3D(width / 2, height / 2, depth / 2);
        collider.height = height;
        collider.rotationY = rotationY;
        return collider;
    }
};
```

### 2. Modify `CollisionSystem.hpp`

Update `checkCollision()` to support OBB (Oriented Bounding Box):

```cpp
// For Box + Box collision (rotated support)
bool checkBoxCollision(
    const Vector3D& posA, const Collider& colliderA,
    const Vector3D& posB, const Collider& colliderB
) const {
    // Check OBB-OBB collision using Separating Axis Theorem (SAT)
    // This handles rotated boxes correctly
}

// For Box + Cylinder collision (already works via cylinder AABB)
bool checkBoxCylinderCollision(
    const Vector3D& posBox, float rotY, const Vector3D& halfExt,
    const Vector3D& posCyl, float radius, float height
) const {
    // Handle collision between rotated box and cylinder
    // Convert cylinder center to box's local space, then AABB test
}
```

### 3. Update JSON format

No changes needed! Just add `rotationY` to JSON:

```json
{
  "id": "forest_zone_1",
  "type": "box",
  "center": {"x": 19.79, "y": 0, "z": -9.41},
  "halfExtents": {"x": 5.04, "y": 1.0, "z": 3.72},
  "rotationY": 0.785,  // ~45 degrees (in radians: PI/4)
  "height": 2.0
}
```

## Current Recommendation

**For now:** Use cylinders (simpler, already works)  
**For precision:** Implement rotation support on Box colliders

Your data is already prepared in `colliders.json` — just needs the backend work.

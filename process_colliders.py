#!/usr/bin/env python3
"""
Collider Data Processor
Converts collected corner points into center + halfExtents JSON

Usage:
    python3 process_colliders.py < collected_points.txt
    
Input format (one per line):
    Zone Name: {"x": 10.0, "z": 5.0} {"x": 15.0, "z": 5.0} {"x": 10.0, "z": 10.0} {"x": 15.0, "z": 10.0}
"""

import json
import sys
from typing import Dict, List, Tuple

def parse_point(point_str: str) -> Tuple[float, float]:
    """Parse {"x": 10.0, "z": 5.0} format"""
    try:
        point_dict = json.loads(point_str)
        return (float(point_dict.get('x', 0)), float(point_dict.get('z', 0)))
    except:
        return None

def calculate_collider(zone_name: str, points: List[Tuple[float, float]]) -> Dict:
    """Calculate center and halfExtents from 4 corner points"""
    if len(points) < 4:
        print(f"Warning: {zone_name} has only {len(points)} points (need 4)", file=sys.stderr)
        return None
    
    xs = [p[0] for p in points]
    zs = [p[1] for p in points]
    
    min_x = min(xs)
    max_x = max(xs)
    min_z = min(zs)
    max_z = max(zs)
    
    center_x = round((min_x + max_x) / 2, 2)
    center_z = round((min_z + max_z) / 2, 2)
    
    half_x = round((max_x - min_x) / 2, 2)
    half_z = round((max_z - min_z) / 2, 2)
    
    # Detect rotation (OBB vs AABB alignment)
    max_deviation = 0
    expected_corners = [
        (min_x, min_z), (min_x, max_z),
        (max_x, min_z), (max_x, max_z)
    ]
    
    for px, pz in points:
        min_dist = min(((px - cx)**2 + (pz - cz)**2)**0.5 for cx, cz in expected_corners)
        max_deviation = max(max_deviation, min_dist)
    
    max_deviation = round(max_deviation, 3)
    is_rotated = max_deviation > 0.1
    
    return {
        "id": zone_name,
        "type": "cylinder",  # Use cylinder for rotated zones
        "center": {"x": center_x, "y": 0, "z": center_z},
        "radius": max(half_x, half_z),
        "height": 2.0,
        "halfExtents": {"x": half_x, "y": 1.0, "z": half_z},
        "rotated": is_rotated,
        "deviation": max_deviation
    }

def main():
    colliders = []
    
    for line in sys.stdin:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        
        # Parse "Zone Name: point1 point2 point3 point4"
        if ':' not in line:
            continue
        
        zone_name, points_str = line.split(':', 1)
        zone_name = zone_name.strip()
        
        # Extract all {...} JSON objects
        import re
        point_strings = re.findall(r'\{[^}]+\}', points_str)
        
        points = []
        for ps in point_strings:
            p = parse_point(ps)
            if p:
                points.append(p)
        
        if len(points) >= 4:
            collider = calculate_collider(zone_name, points)
            if collider:
                colliders.append(collider)
                print(f"✓ {zone_name}: center=({collider['center']['x']}, {collider['center']['z']}), "
                      f"radius={collider['radius']}, rotated={collider['rotated']}", file=sys.stderr)
        else:
            print(f"✗ {zone_name}: insufficient points ({len(points)}/4)", file=sys.stderr)
    
    # Output JSON
    print(json.dumps(colliders, indent=2))

if __name__ == "__main__":
    main()

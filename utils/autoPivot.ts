import { CharacterComposition, CharacterPart } from "../types";
import { compensateAnchorShift } from "./animationUtils";

const getBoundingBox = (part: CharacterPart, allParts?: Record<string, CharacterPart>, absX=0, absY=0): any => {
  // Since all layer parts in Animato use absolute canvas positioning,
  // we do not add parent offsets to avoid double-adding coordinate values.
  const rx = part.transform.x;
  const ry = part.transform.y;
  const rw = part.width || 0;
  const rh = part.height || 0;

  if (rw === 0 && rh === 0 && part.children && part.children.length > 0 && allParts) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let hasValidChild = false;
    
    for (const childId of part.children) {
      if (allParts[childId]) {
         const cbox = getBoundingBox(allParts[childId], allParts, 0, 0);
         if (cbox) {
           minX = Math.min(minX, cbox.left);
           maxX = Math.max(maxX, cbox.right);
           minY = Math.min(minY, cbox.top);
           maxY = Math.max(maxY, cbox.bottom);
           hasValidChild = true;
         }
      }
    }
    if (hasValidChild) {
       return { left: minX, right: maxX, top: minY, bottom: maxY, centerXY: true };
    }
  }

  // Base case
  if (rw === 0 && rh === 0) return null;
  return {
    left: rx - rw / 2,
    right: rx + rw / 2,
    top: ry - rh / 2,
    bottom: ry + rh / 2,
  };
};

const intersectRects = (r1: ReturnType<typeof getBoundingBox>, r2: ReturnType<typeof getBoundingBox>) => {
  const left = Math.max(r1.left, r2.left);
  const right = Math.min(r1.right, r2.right);
  const top = Math.max(r1.top, r2.top);
  const bottom = Math.min(r1.bottom, r2.bottom);

  if (left < right && top < bottom) {
    return {
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      width: right - left,
      height: bottom - top,
    };
  }
  return null;
};

// Simple heuristic to guess attachment parent by name
const guessParentId = (partId: string, partLabel: string, allParts: CharacterPart[]) => {
  const label = partLabel.toLowerCase();
  
  const isLeft = label.includes("left") || label.startsWith("l_") || label.includes("_l_") || label.endsWith("_l") || label.startsWith("l ") || label.includes(" l ");
  const isRight = label.includes("right") || label.startsWith("r_") || label.includes("_r_") || label.endsWith("_r") || label.startsWith("r ") || label.includes(" r ");

  const hasLowerIndicator = label.includes("lower") || label.includes("fore") || label.includes("elbow") || label.includes("_low") || label.endsWith("low") || label.includes("sub") || label.includes("bottom");
  const hasUpperIndicator = label.includes("upper") || label.includes("bicep") || label.includes("shoulder") || label.includes("_up") || label.endsWith("up") || label.includes("top");

  const findByName = (keywords: string[]) => {
    // Score based on which keyword matched first (lower index = higher priority)
    const getScore = (lbl: string) => {
      const idx = keywords.findIndex(k => lbl.includes(k));
      return idx === -1 ? 999 : idx;
    };

    const candidates = allParts.filter(p => {
      if (p.id === partId) return false;
      const lower = p.label.toLowerCase();
      
      const pIsLeft = lower.includes("left") || lower.startsWith("l_") || lower.includes("_l_") || lower.endsWith("_l") || lower.startsWith("l ") || lower.includes(" l ");
      const pIsRight = lower.includes("right") || lower.startsWith("r_") || lower.includes("_r_") || lower.endsWith("_r") || lower.startsWith("r ") || lower.includes(" r ");
      
      // Keep alignment across left/right paths
      if ((isLeft && pIsRight) || (isRight && pIsLeft)) return false;

      return keywords.some(k => lower.includes(k));
    });

    candidates.sort((a, b) => getScore(a.label.toLowerCase()) - getScore(b.label.toLowerCase()));

    if (isLeft) {
      const best = candidates.find(p => p.label.toLowerCase().includes("left") || p.label.toLowerCase().startsWith("l_") || p.label.toLowerCase().endsWith("_l") || p.label.toLowerCase().includes("_l_") || p.label.toLowerCase().startsWith("l ") || p.label.toLowerCase().includes(" l "));
      if (best) return best;
    }
    if (isRight) {
      const best = candidates.find(p => p.label.toLowerCase().includes("right") || p.label.toLowerCase().startsWith("r_") || p.label.toLowerCase().endsWith("_r") || p.label.toLowerCase().includes("_r_") || p.label.toLowerCase().startsWith("r ") || p.label.toLowerCase().includes(" r "));
      if (best) return best;
    }
    
    return candidates[0];
  };

  // 1. Hands: attach to lower arm / forearm
  if (label.includes("hand") || label.includes("palm") || label.includes("wrist") || label.includes("finger") || label.includes("fist")) {
    return findByName(["lower arm", "forearm", "lower_arm", "elbow", "arm_lower", "lowerarm", "arm"])?.id;
  }

  // 2. Lower Leg (Calf / Shin): attach to thigh / upper leg
  if (label.includes("lower leg") || label.includes("calf") || label.includes("shin") || (label.includes("leg") && label.includes("lower")) || label.includes("knee") || label.includes("lower_leg") || label.includes("lowerleg") || label.includes("leg_lower")) {
    return findByName(["upper leg", "thigh", "upper_leg", "upperleg", "leg_upper", "leg", "hip", "hips", "pelvis"])?.id;
  }

  // 3. Lower arm: attach to upper arm / biceps
  if (hasLowerIndicator && label.includes("arm")) {
    return findByName(["upper arm", "bicep", "biceps", "shoulder", "upper_arm", "arm_upper", "upperarm", "arm"])?.id;
  }
  if (label.includes("forearm") || label.includes("elbow")) {
    return findByName(["upper arm", "bicep", "biceps", "shoulder", "upper_arm", "arm_upper", "upperarm", "arm"])?.id;
  }

  // 4. Upper Arm (Biceps / Shoulder): attach to torso / body
  if (hasUpperIndicator && label.includes("arm")) {
    return findByName(["torso", "body", "chest", "spine", "pelvis"])?.id;
  }
  if (label.includes("bicep") || label.includes("biceps") || label.includes("shoulder")) {
    return findByName(["torso", "body", "chest", "spine", "pelvis"])?.id;
  }

  // General Arm: if it's not explicitly lower or upper, try to check if there is an upper arm
  if (label.includes("arm")) {
    const parentUpper = findByName(["upper arm", "bicep", "biceps", "shoulder", "upper_arm", "arm_upper", "upperarm"]);
    if (parentUpper) return parentUpper.id;
    return findByName(["torso", "body", "chest", "spine", "pelvis"])?.id;
  }

  // 5. Foot / Feet / Toes: attach to lower leg
  if (label.includes("foot") || label.includes("feet") || label.includes("toe") || label.includes("toes") || label.includes("ankle")) {
    return findByName(["lower leg", "calf", "shin", "lower_leg", "leg_lower", "lowerleg", "knee", "leg"])?.id;
  }

  // 6. Upper Leg (Thigh): attach to pelvis / hips / body
  if (hasUpperIndicator && label.includes("leg")) {
    return findByName(["torso", "body", "pelvis", "hips", "hip", "chest", "spine"])?.id;
  }
  if (label.includes("thigh") || label.includes("upper leg") || label.includes("upperleg")) {
    return findByName(["torso", "body", "pelvis", "hips", "hip", "chest", "spine"])?.id;
  }

  // General Leg has lower hips/pelvis parenting or body parenting
  if (label.includes("leg")) {
    return findByName(["torso", "body", "pelvis", "hips", "hip", "chest", "spine"])?.id;
  }

  // 7. Head: attach to neck or body
  if (label.includes("head") || label.includes("face") || label.includes("skull")) {
    return findByName(["neck", "torso", "body", "chest", "spine"])?.id;
  }
  if (label.includes("neck")) {
    return findByName(["torso", "body", "chest", "spine"])?.id;
  }

  // 8. Facial elements of head
  if (label.includes("hair") || label.includes("hat") || label.includes("glasses") || label.includes("eye") || label.includes("mouth") || label.includes("nose") || label.includes("ear") || label.includes("back hair") || label.includes("whisker") || label.includes("blush") || label.includes("brow") || label.includes("eyebrow")) {
    return findByName(["head group", "head", "face"])?.id;
  }
  
  return undefined;
};

const calculateFallbackAnchor = (
  part: CharacterPart,
  parentPart: CharacterPart
): { anchorX: number; anchorY: number } => {
  const label = part.label.toLowerCase();
  
  // Default centered pivot
  let anchorX = 50;
  let anchorY = 50;

  const dx = parentPart.transform.x - part.transform.x;
  const dy = parentPart.transform.y - part.transform.y;

  // Head connects at the bottom
  if (label.includes("head") || label.includes("face") || label.includes("skull")) {
    return { anchorX: 50, anchorY: 90 };
  }
  
  // Neck connects at bottom to body or top to head
  if (label.includes("neck")) {
    return { anchorX: 50, anchorY: 90 };
  }

  // Facial elements stay centered
  if (label.includes("hair") || label.includes("hat") || label.includes("eye") || label.includes("mouth") || label.includes("nose") || label.includes("ear") || label.includes("eyebrow") || label.includes("brow")) {
    return { anchorX: 50, anchorY: 50 };
  }

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDy > absDx) {
    if (dy < 0) {
      // Parent is above part
      anchorX = 50;
      anchorY = 10;
    } else {
      // Parent is below part
      anchorX = 50;
      anchorY = 90;
    }
  } else {
    if (dx < 0) {
      // Parent is to left of part
      anchorX = 10;
      anchorY = 50;
    } else {
      // Parent is to right of part
      anchorX = 95;
      anchorY = 50;
    }
  }

  return { anchorX, anchorY };
};

export const autoCalculatePivots = (composition: CharacterComposition): CharacterComposition => {
  // Check if our composition has been imported from a PSD file (PSD parts have keys starting with 'psd_')
  const hasPsdLayers = Object.keys(composition).some(key => key.startsWith("psd_"));

  const out = JSON.parse(JSON.stringify(composition)) as CharacterComposition;
  const parts = Object.values(out); 

  // First Pass: Calculate valid bounds (width, height, x, y) for structural groups that have 0 width/height
  parts.forEach(part => {
      if (part.isGroup && (part.width === 0 || !part.width) && part.children && part.children.length > 0) {
          const box = getBoundingBox(part, out, 0, 0);
          if (box) {
              part.width = box.right - box.left;
              part.height = box.bottom - box.top;
              part.transform.x = box.left + part.width / 2;
              part.transform.y = box.top + part.height / 2;
          }
      }
  });

  for (const part of parts) {
    if (part.label.toLowerCase().includes("anchor")) continue; // avoid modifying anchor points themselves if present
    const parentId = guessParentId(part.id, part.label, parts);
    if (!parentId) continue;

    const parentPart = out[parentId];
    if (!parentPart) continue;

    // Apply strict parenting relationship based on guess ONLY if NOT a PSD composition
    if (!hasPsdLayers) {
      if (part.parentId !== parentId) {
         if (part.parentId && out[part.parentId]) {
             out[part.parentId].children = out[part.parentId].children.filter(id => id !== part.id);
         }
         part.parentId = parentId;
         if (!parentPart.children.includes(part.id)) {
              parentPart.children.push(part.id);
         }
      }
    }

    const box1 = getBoundingBox(part, out, 0, 0);
    const box2 = getBoundingBox(parentPart, out, 0, 0);
    if (!box1 || !box2) continue;
    
    const intersection = intersectRects(box1, box2);
    
    let finalAnchorX = 50;
    let finalAnchorY = 50;

    // Anatomical Priority Fallbacks (Overrides standard intersection, as intersection can be unreliable for soft/overlapping PSD layers)
    const lbl = part.label.toLowerCase();
    let anatomicalOverride = false;
    
    if (lbl.includes("upper arm") || lbl.includes("bicep") || lbl.includes("shoulder") || lbl.includes("arm upper")) {
        finalAnchorX = 50; finalAnchorY = 15; anatomicalOverride = true;
    } else if (lbl.includes("lower arm") || lbl.includes("forearm") || lbl.includes("arm lower")) {
        finalAnchorX = 50; finalAnchorY = 15; anatomicalOverride = true;
    } else if (lbl.includes("hand") || lbl.includes("fist") || lbl.includes("palm")) {
        finalAnchorX = 50; finalAnchorY = 15; anatomicalOverride = true; // wrist is usually at top of hand bounding box
    } else if (lbl.includes("upper leg") || lbl.includes("thigh") || lbl.includes("leg upper")) {
        finalAnchorX = 50; finalAnchorY = 15; anatomicalOverride = true;
    } else if (lbl.includes("lower leg") || lbl.includes("calf") || lbl.includes("shin") || lbl.includes("leg lower")) {
        finalAnchorX = 50; finalAnchorY = 15; anatomicalOverride = true;
    } else if (lbl.includes("foot") || lbl.includes("feet") || lbl.includes("shoe")) {
        finalAnchorX = 50; finalAnchorY = 20; anatomicalOverride = true; // ankle is usually near the top
    } else if (lbl.includes("head") || lbl.includes("face") || lbl.includes("skull") || lbl.includes("neck")) {
        finalAnchorX = 50; finalAnchorY = 95; anatomicalOverride = true; // anchor at neck base
    } else if (lbl.includes("torso") || lbl.includes("body") || lbl.includes("chest") || lbl.includes("abdomen")) {
        finalAnchorX = 50; finalAnchorY = 50; anatomicalOverride = true; // rotate body around center
    }

    if (!anatomicalOverride) {
        if (intersection && intersection.width > 2 && intersection.height > 2) {
          const pWidth = part.width || 150;
          const pHeight = part.height || 150;
          
          const realBoxLeft = (part.transform.x) - pWidth / 2;
          const realBoxTop = (part.transform.y) - pHeight / 2;

          // Calculate intersection anchor in percentage relative to part's box
          const anchorXPercent = ((intersection.x - realBoxLeft) / pWidth) * 100;
          const anchorYPercent = ((intersection.y - realBoxTop) / pHeight) * 100;

          finalAnchorX = Math.max(5, Math.min(95, anchorXPercent));
          finalAnchorY = Math.max(5, Math.min(95, anchorYPercent));
        } else {
          // Fallback relative position layout calculation
          const fallback = calculateFallbackAnchor(part, parentPart);
          finalAnchorX = fallback.anchorX;
          finalAnchorY = fallback.anchorY;
        }
    }

    const oldAnchorX = part.transform.anchorX ?? 50;
    const oldAnchorY = part.transform.anchorY ?? 50;
    const pWidth = part.width || 150;
    const pHeight = part.height || 150;

    // Compensate transform x and y so the visual positioning stays correct
    const compensated = compensateAnchorShift(
      part.transform.x, part.transform.y,
      part.transform.rotation,
      part.transform.scaleX, part.transform.scaleY,
      !!part.transform.flipX, !!part.transform.flipY,
      oldAnchorX, oldAnchorY,
      finalAnchorX, finalAnchorY,
      pWidth, pHeight
    );

    part.transform.anchorX = finalAnchorX;
    part.transform.anchorY = finalAnchorY;
    part.transform.x = compensated.x;
    part.transform.y = compensated.y;
  }

  return out;
};

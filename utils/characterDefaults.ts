
import { CharacterComposition, CharacterPart, TransformState } from '../types';

export const DEFAULT_TRANSFORM: TransformState = { 
    x: 0, 
    y: 0, 
    scaleX: 1, 
    scaleY: 1, 
    rotation: 0, 
    anchorX: 50, 
    anchorY: 50,
    flipX: false,
    flipY: false
};

export const createPart = (id: string, label: string, parentId: string | null, zIndex: number, overrides: Partial<CharacterPart> = {}): CharacterPart => {
    const transform = { ...DEFAULT_TRANSFORM, ...overrides.transform };
    return {
      id, label, parentId, zIndex,
      imageUrl: null,
      transform,
      baseTransform: { ...transform }, 
      tags: overrides.tags || [label],
      bones: overrides.bones || [],
      children: overrides.children || [],
      isGroup: overrides.isGroup || false,
      isIndependent: overrides.isIndependent || false,
      isOpen: overrides.isOpen !== undefined ? overrides.isOpen : true,
      isVisible: overrides.isVisible !== undefined ? overrides.isVisible : true,
      ...overrides,
    };
};

export const getInitialParts = (): CharacterComposition => {
  const parts: CharacterComposition = {};
  
  parts['root'] = createPart('root', 'Character Root', null, 0, { isGroup: true, isOpen: true });
  parts['headGroup'] = createPart('headGroup', 'Head Group', 'root', 50, { isGroup: true, transform: { x: 0, y: -50, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 50, anchorY: 50 }, tags: ['Head'], isOpen: true });
  parts['bodyGroup'] = createPart('bodyGroup', 'Body Group', 'root', 10, { isGroup: true, transform: { x: 0, y: 100, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 50, anchorY: 50 }, tags: ['Body'], isOpen: true });
  
  parts['head'] = createPart('head', 'Head Base', 'headGroup', 10);
  parts['hair'] = createPart('hair', 'Hair', 'headGroup', 100, { transform: { ...DEFAULT_TRANSFORM, y: -80 } });
  
  parts['leftEyebrow'] = createPart('leftEyebrow', 'Left Eyebrow', 'headGroup', 60, { transform: { ...DEFAULT_TRANSFORM, x: -30, y: -45 }, tags: ['Eyebrow'] });
  parts['rightEyebrow'] = createPart('rightEyebrow', 'Right Eyebrow', 'headGroup', 60, { transform: { ...DEFAULT_TRANSFORM, x: 30, y: -45 }, tags: ['Eyebrow'] });

  parts['leftEyeGroup'] = createPart('leftEyeGroup', 'Left Eye', 'headGroup', 50, { isGroup: true, transform: { ...DEFAULT_TRANSFORM, x: -35, y: -10 }, isOpen: true });
  parts['leftEyeball'] = createPart('leftEyeball', 'Left Eyeball', 'leftEyeGroup', 1, { tags: ['Eyeball'] });
  parts['leftPupil'] = createPart('leftPupil', 'Left Pupil', 'leftEyeGroup', 2, { tags: ['Pupil'] });
  parts['leftBlink'] = createPart('leftBlink', 'Left Blink', 'leftEyeGroup', 4, { tags: ['Blink'] }); 
  parts['leftEyelid'] = createPart('leftEyelid', 'Left Eyelid', 'leftEyeGroup', 3, { tags: ['Eyelid'] });

  parts['rightEyeGroup'] = createPart('rightEyeGroup', 'Right Eye', 'headGroup', 50, { isGroup: true, transform: { ...DEFAULT_TRANSFORM, x: 35, y: -10 }, isOpen: true });
  parts['rightEyeball'] = createPart('rightEyeball', 'Right Eyeball', 'rightEyeGroup', 1, { tags: ['Eyeball'] });
  parts['rightPupil'] = createPart('rightPupil', 'Right Pupil', 'rightEyeGroup', 2, { tags: ['Pupil'] });
  parts['rightBlink'] = createPart('rightBlink', 'Right Blink', 'rightEyeGroup', 4, { tags: ['Blink'] });
  parts['rightEyelid'] = createPart('rightEyelid', 'Right Eyelid', 'rightEyeGroup', 3, { tags: ['Eyelid'] });

  parts['mouth'] = createPart('mouth', 'Mouth', 'headGroup', 40, { isGroup: true, transform: { ...DEFAULT_TRANSFORM, y: 50, scaleX: 1, scaleY: 1 }, tags: ['Mouth'] });
  parts['nose'] = createPart('nose', 'Nose', 'headGroup', 45, { transform: { ...DEFAULT_TRANSFORM, y: 20 } });
  parts['body'] = createPart('body', 'Body', 'bodyGroup', 10);
  
  parts['leftArm'] = createPart('leftArm', 'Left Arm', 'bodyGroup', 5, { transform: { ...DEFAULT_TRANSFORM, x: -60, y: -20 } });
  parts['rightArm'] = createPart('rightArm', 'Right Arm', 'bodyGroup', 5, { transform: { ...DEFAULT_TRANSFORM, x: 60, y: -20 } });
  parts['leftLeg'] = createPart('leftLeg', 'Left Leg', 'bodyGroup', 1, { transform: { ...DEFAULT_TRANSFORM, x: -30, y: 100 } });
  parts['rightLeg'] = createPart('rightLeg', 'Right Leg', 'bodyGroup', 1, { transform: { ...DEFAULT_TRANSFORM, x: 30, y: 100 } });

  Object.values(parts).forEach((part: CharacterPart) => {
    if (part.parentId && parts[part.parentId]) {
      parts[part.parentId].children.push(part.id);
    }
  });

  Object.values(parts).forEach((part: CharacterPart) => {
    if (part.children && part.children.length > 0) {
      part.children.sort((a, b) => (parts[b].zIndex || 0) - (parts[a].zIndex || 0));
    }
  });

  return parts;
};

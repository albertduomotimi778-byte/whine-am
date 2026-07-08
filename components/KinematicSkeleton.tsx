import React, { useMemo } from 'react';

interface KinematicSkeletonProps {
  character: Record<string, any>;
  selectedPartId: string | null;
  onSelectPart: (partId: string) => void;
}

const findPart = (character: Record<string, any>, names: string[]) => {
  const parts = Object.values(character || {});
  for (const name of names) {
    const found = parts.find(p => p.label?.toLowerCase().includes(name));
    if (found) return found.id;
  }
  return null;
}

export const KinematicSkeleton: React.FC<KinematicSkeletonProps> = ({ character, selectedPartId, onSelectPart }) => {
  const mapping = useMemo(() => {
    return {
      head: findPart(character, ['head group', 'head', 'face']),
      body: 'root',
      l_biceps: findPart(character, ['left upper arm', 'left biceps', 'l_biceps', 'left shoulder', 'l_shoulder']),
      l_arm: findPart(character, ['left lower arm', 'left arm', 'l_arm', 'left elbow', 'l_elbow']),
      l_hand: findPart(character, ['left hand', 'l_hand']),
      r_biceps: findPart(character, ['right upper arm', 'right biceps', 'r_biceps', 'right shoulder', 'r_shoulder']),
      r_arm: findPart(character, ['right lower arm', 'right arm', 'r_arm', 'right elbow', 'r_elbow']),
      r_hand: findPart(character, ['right hand', 'r_hand']),
      l_hips: findPart(character, ['left hips', 'l_hips', 'left hip', 'l_hip']),
      l_knee: findPart(character, ['left leg', 'left knee', 'l_knee', 'left calf', 'l_calf']),
      l_leg_feet: findPart(character, ['left feet', 'left foot', 'l_foot', 'left leg feet']),
      r_hips: findPart(character, ['right hips', 'r_hips', 'right hip', 'r_hip']),
      r_knee: findPart(character, ['right leg', 'right knee', 'r_knee', 'right calf', 'r_calf']),
      r_leg_feet: findPart(character, ['right feet', 'right foot', 'r_foot', 'right leg feet']),
    }
  }, [character]);

  const Node = ({ cx, cy, id, mappingKey }: { cx: number, cy: number, id: string, mappingKey: string }) => {
    const partId = mapping[mappingKey as keyof typeof mapping];
    const isSelected = selectedPartId === partId;
    
    return (
      <circle 
        cx={cx} cy={cy} r="6"
        fill={isSelected ? "#06b6d4" : (partId ? "#555" : "#333")}
        stroke={isSelected ? "#fff" : "transparent"}
        strokeWidth="2"
        className="cursor-pointer transition-all hover:fill-cyan-400"
        onClick={() => partId && onSelectPart(partId)}
        title={partId ? character[partId]?.label : `No part found for ${mappingKey}`}
      />
    )
  }

  return (
    <div className="w-full flex justify-center py-4">
      <svg width="100%" height="100%" style={{ maxHeight: '180px' }} viewBox="0 0 100 160" className="opacity-100 drop-shadow-md">
        {/* Head outline */}
        <circle cx="50" cy="15" r="12" fill="none" stroke="#555" strokeWidth="3" />
        
        {/* Skeleton Lines */}
        <path d="M 50 27 L 50 75" stroke="#555" strokeWidth="3" strokeLinecap="round" /> {/* Spine */}
        
        {/* Arms */}
        <path d="M 50 35 L 30 45 L 23 65 L 18 85" stroke="#555" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /> {/* Left Arm */}
        <path d="M 50 35 L 70 45 L 77 65 L 82 85" stroke="#555" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /> {/* Right Arm */}
        
        {/* Legs */}
        <path d="M 50 75 L 35 75 L 35 110 L 35 145" stroke="#555" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /> {/* Left Leg */}
        <path d="M 50 75 L 65 75 L 65 110 L 65 145" stroke="#555" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /> {/* Right Leg */}
        
        {/* Nodes */}
        <Node cx={50} cy={27} id="head" mappingKey="head" />
        <Node cx={50} cy={55} id="body" mappingKey="body" />
        
        <Node cx={30} cy={45} id="r_biceps" mappingKey="r_biceps" />
        <Node cx={23} cy={65} id="r_arm" mappingKey="r_arm" />
        <Node cx={18} cy={85} id="r_hand" mappingKey="r_hand" />
        
        <Node cx={70} cy={45} id="l_biceps" mappingKey="l_biceps" />
        <Node cx={77} cy={65} id="l_arm" mappingKey="l_arm" />
        <Node cx={82} cy={85} id="l_hand" mappingKey="l_hand" />
        
        <Node cx={35} cy={75} id="r_hips" mappingKey="r_hips" />
        <Node cx={35} cy={110} id="r_knee" mappingKey="r_knee" />
        <Node cx={35} cy={145} id="r_leg_feet" mappingKey="r_leg_feet" />
        
        <Node cx={65} cy={75} id="l_hips" mappingKey="l_hips" />
        <Node cx={65} cy={110} id="l_knee" mappingKey="l_knee" />
        <Node cx={65} cy={145} id="l_leg_feet" mappingKey="l_leg_feet" />
      </svg>
    </div>
  )
}

import React, { useState, useEffect, useCallback, useRef } from "react";

interface FastSliderProps {
    value: number;
    onChange: (val: number) => void;
    onInteractionStart?: (e: React.PointerEvent) => void;
    onInteractionEnd?: (e: React.PointerEvent) => void;
    min: number;
    max: number;
    step: number;
    className?: string;
}

export function FastSlider({
    value,
    onChange,
    onInteractionStart,
    onInteractionEnd,
    min,
    max,
    step,
    className
}: FastSliderProps) {
    const [localValue, setLocalValue] = useState(value);
    const [isDragging, setIsDragging] = useState(false);
    
    useEffect(() => {
        if (!isDragging) {
            setLocalValue(value);
        }
    }, [value, isDragging]);
    
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const numValue = parseFloat(e.target.value);
        setLocalValue(numValue);
        onChange(numValue);
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
        setIsDragging(true);
        if (onInteractionStart) onInteractionStart(e);
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
        setIsDragging(false);
        if (onInteractionEnd) onInteractionEnd(e);
    };
    
    return (
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={localValue}
            onChange={handleChange}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            className={className}
        />
    );
}

import React, { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface MascotProps {
  mousePosition: { x: number; y: number };
  isCoveringEyes: boolean;
}

const Mascot: React.FC<MascotProps> = ({ mousePosition, isCoveringEyes }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pupilOffset, setPupilOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (isCoveringEyes || !containerRef.current) {
      if (isCoveringEyes) {
        setPupilOffset({ x: 0, y: 0 }); // reset eyes when covered
      }
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const deltaX = mousePosition.x - centerX;
    const deltaY = mousePosition.y - centerY;

    const angle = Math.atan2(deltaY, deltaX);
    const maxDistance = 6;
    const distance = Math.min(Math.sqrt(deltaX * deltaX + deltaY * deltaY) / 50, 1);

    setPupilOffset({
      x: Math.cos(angle) * maxDistance * distance,
      y: Math.sin(angle) * maxDistance * distance,
    });
  }, [mousePosition, isCoveringEyes]);

  return (
    <div className="relative w-32 h-32 mx-auto mb-2" ref={containerRef}>
      {/* Body/Head base */}
      <div className="absolute inset-0 bg-primary/10 rounded-[40px] border-4 border-primary/20 flex items-center justify-center overflow-hidden z-0">
        <div className="relative w-full h-full">
          
          {/* Left Eye */}
          <div className="absolute left-5 top-10 w-7 h-9 bg-background rounded-full border-2 border-border shadow-inner overflow-hidden">
            <div 
              className="absolute w-4 h-4 bg-foreground rounded-full"
              style={{ 
                left: '50%', 
                top: '50%', 
                marginLeft: '-8px', 
                marginTop: '-8px',
                transform: `translate(${pupilOffset.x}px, ${pupilOffset.y}px)`
              }}
            />
          </div>
          
          {/* Right Eye */}
          <div className="absolute right-5 top-10 w-7 h-9 bg-background rounded-full border-2 border-border shadow-inner overflow-hidden">
            <div 
              className="absolute w-4 h-4 bg-foreground rounded-full"
              style={{ 
                left: '50%', 
                top: '50%', 
                marginLeft: '-8px', 
                marginTop: '-8px',
                transform: `translate(${pupilOffset.x}px, ${pupilOffset.y}px)`
              }}
            />
          </div>

          {/* Nose */}
          <div className="absolute left-[54px] top-16 w-3 h-2 bg-primary/40 rounded-full" />
          
          {/* Mouth */}
          <motion.div 
            className="absolute top-[80px] h-4 border-b-2 border-foreground rounded-b-full"
            style={{ left: '50%', x: '-50%' }}
            animate={{ 
              scaleY: isCoveringEyes ? 0.2 : 1,
              width: isCoveringEyes ? 12 : 32
            }}
            transition={{ duration: 0.2 }}
          />
        </div>
      </div>

      {/* Hands covering eyes */}
      {/* Left Hand */}
      <motion.div
        className="absolute bg-primary rounded-full shadow-lg border-2 border-background z-20"
        style={{ width: 56, height: 48 }}
        initial={false}
        animate={{ 
          top: isCoveringEyes ? 32 : 110, 
          left: isCoveringEyes ? 14 : -20, 
          rotate: isCoveringEyes ? 15 : -40,
        }}
        transition={{ type: 'spring', stiffness: 350, damping: 25 }}
      >
        <div className="absolute top-2 right-2 w-3 h-5 bg-background/20 rounded-full" />
      </motion.div>

      {/* Right Hand */}
      <motion.div
        className="absolute bg-primary rounded-full shadow-lg border-2 border-background z-20"
        style={{ width: 56, height: 48 }}
        initial={false}
        animate={{ 
          top: isCoveringEyes ? 32 : 110, 
          right: isCoveringEyes ? 14 : -20, 
          rotate: isCoveringEyes ? -15 : 40,
        }}
        transition={{ type: 'spring', stiffness: 350, damping: 25 }}
      >
        <div className="absolute top-2 left-2 w-3 h-5 bg-background/20 rounded-full" />
      </motion.div>
    </div>
  );
};

export default Mascot;

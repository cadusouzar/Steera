import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

// Generate random lines outside so they don't re-render on mouse movement
const generateLines = (count: number) => {
  return Array.from({ length: count }).map((_, i) => ({
    id: i,
    top: `${Math.random() * 100}%`,
    left: `${Math.random() * 100}%`,
    duration: Math.random() * 6 + 4, // 4s to 10s (fast flow)
    delay: Math.random() * 5,
    opacity: Math.random() * 0.6 + 0.4, // stronger opacity
    width: Math.random() * 12 + 4, // Much thicker lines
  }));
};

const FlowBackground = () => {
  // Memoize so it never changes even if parent re-renders
  const verticalLines = useMemo(() => generateLines(20), []);
  const horizontalLines = useMemo(() => generateLines(12), []);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none bg-background">
      {/* Vertical lines */}
      <div className="absolute inset-0 opacity-80 dark:opacity-60">
        {verticalLines.map((line) => (
          <motion.div
            key={`v-${line.id}`}
            className="absolute bg-gradient-to-b from-transparent via-primary to-transparent blur-[2px]"
            style={{
              top: 0,
              left: line.left,
              width: `${line.width}px`,
              height: '60vh',
              opacity: line.opacity,
            }}
            initial={{ y: '-100vh' }}
            animate={{ y: '200vh' }}
            transition={{
              duration: line.duration,
              repeat: Infinity,
              ease: "linear",
              delay: line.delay
            }}
          />
        ))}
      </div>
      
      {/* Horizontal lines */}
      <div className="absolute inset-0 opacity-70 dark:opacity-50">
        {horizontalLines.map((line) => (
          <motion.div
            key={`h-${line.id}`}
            className="absolute bg-gradient-to-r from-transparent via-accent to-transparent blur-[2px]"
            style={{
              top: line.top,
              left: 0,
              height: `${line.width}px`,
              width: '60vw',
              opacity: line.opacity,
            }}
            initial={{ x: '-100vw' }}
            animate={{ x: '200vw' }}
            transition={{
              duration: line.duration * 1.2,
              repeat: Infinity,
              ease: "linear",
              delay: line.delay
            }}
          />
        ))}
      </div>
      
      {/* Soft gradient overlay to blend into the background (less aggressive) */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background z-10 opacity-70" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-transparent to-background z-10 opacity-70" />
    </div>
  );
};

export default React.memo(FlowBackground);

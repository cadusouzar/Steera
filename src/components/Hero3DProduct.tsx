import { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Icosahedron, MeshDistortMaterial } from '@react-three/drei';
import * as THREE from 'three';

const ProductPlaceholder = ({ theme }: { theme: 'light' | 'dark' }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.x = state.clock.elapsedTime * 0.2;
    meshRef.current.rotation.y = state.clock.elapsedTime * 0.3;
    
    // Gentle floating
    meshRef.current.position.y = Math.sin(state.clock.elapsedTime) * 0.2;
  });

  const wireframeColor = theme === 'dark' ? '#3B82F6' : '#2563EB';

  return (
    <group>
      <ambientLight intensity={theme === 'dark' ? 0.5 : 0.8} />
      <directionalLight position={[10, 10, 5]} intensity={1.5} />
      
      <Icosahedron ref={meshRef} args={[2.5, 2]} position={[0, 0, 0]}>
        <MeshDistortMaterial
          color={theme === 'dark' ? '#0F172A' : '#F8FAFC'}
          attach="material"
          distort={0.4}
          speed={1.5}
          roughness={0.2}
          metalness={0.8}
          wireframe={true}
          wireframeLinewidth={2}
        />
      </Icosahedron>
      
      {/* Inner core */}
      <Icosahedron args={[1.5, 0]}>
        <meshStandardMaterial 
          color={wireframeColor}
          opacity={0.8}
          transparent
          roughness={0.1}
          metalness={0.9}
        />
      </Icosahedron>
    </group>
  );
};

const Hero3DProduct = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          const isDark = document.documentElement.classList.contains('dark');
          setTheme(isDark ? 'dark' : 'light');
        }
      });
    });
    
    observer.observe(document.documentElement, { attributes: true });
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    
    return () => observer.disconnect();
  }, []);

  return (
    <div className="w-full h-[400px] md:h-[600px] relative pointer-events-auto">
      {/* Placeholder glass container to anchor the 3D element */}
      <div className="absolute inset-4 md:inset-8 glass-panel rounded-[2rem] md:rounded-[3rem] overflow-hidden bg-white/20 dark:bg-black/20 z-0 border border-border">
        <Canvas 
          camera={{ position: [0, 0, 8], fov: 45 }}
          dpr={[1, 2]} 
          gl={{ antialias: true, alpha: true }}
          className="absolute inset-0 w-full h-full"
        >
          <ProductPlaceholder theme={theme} />
        </Canvas>
        
        {/* Helper overlay for context */}
        <div className="absolute bottom-6 left-6 right-6 text-center z-10 pointer-events-none">
          <p className="text-xs font-mono text-foreground/50 uppercase tracking-wider">
            [ Espaço Reservado para Visualização 3D do Produto ]
          </p>
        </div>
      </div>
    </div>
  );
};

export default Hero3DProduct;

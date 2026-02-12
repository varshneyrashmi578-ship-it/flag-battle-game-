
import React, { useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';
import { COUNTRIES } from '../constants/countries';
import { GameStatus, Country, FlagShape, VisualTheme } from '../types';

const { Engine, Render, Runner, World, Bodies, Body, Composite, Events } = Matter;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  alpha: number;
}

interface EliminationFlash {
  x: number;
  y: number;
  alpha: number;
  size: number;
  maxSize: number;
}

interface GameProps {
  status: GameStatus;
  flagShape: FlagShape;
  theme: VisualTheme;
  gapSize: number;
  bounceIntensity: number;
  paused: boolean;
  onGameEnd: (winner: Country) => void;
  onWinnerDetected?: (winner: Country) => void;
  onElimination: (country: Country) => void;
  onStatusChange: (status: GameStatus) => void;
  onActiveUpdate?: (countries: Country[]) => void;
  onCountdownTick?: (tick: number) => void;
  targetWinnerId?: string | null;
}

const Game: React.FC<GameProps> = ({ 
  status, flagShape, theme, gapSize, bounceIntensity, paused, 
  onGameEnd, onWinnerDetected, onElimination, onStatusChange, onActiveUpdate, 
  onCountdownTick, targetWinnerId 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);
  const countriesRef = useRef<Map<number, Country>>(new Map());
  const textureCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const [countdown, setCountdown] = useState<number | null>(null);
  const initializedRef = useRef(false);
  const boundaryPartsRef = useRef<Matter.Body[]>([]);
  const frameCountRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const flashesRef = useRef<EliminationFlash[]>([]);
  const shakeIntensityRef = useRef(0);
  
  const [victoryFlagId, setVictoryFlagId] = useState<number | null>(null);
  const victoryProgressRef = useRef(0);
  const hasEndedRef = useRef(false);

  const CANVAS_SIZE = 800;
  const CENTER_X = CANVAS_SIZE / 2;
  const CENTER_Y = (CANVAS_SIZE / 2) + 60;
  const CIRCLE_RADIUS = 160; 
  const SEGMENT_COUNT = 100; 
  const rotationRef = useRef(Math.PI * 1.5);
  const omega = 0.015; 

  const themeAssets = {
    [VisualTheme.SPACE]: { segment: '#3b82f6', elimination: '#ef4444', particle: ['#ffffff', '#3b82f6'] },
    [VisualTheme.NIGHT]: { segment: '#6366f1', elimination: '#ec4899', particle: ['#ffffff', '#6366f1'] },
    [VisualTheme.DESERT]: { segment: '#f59e0b', elimination: '#b91c1c', particle: ['#ffffff', '#f59e0b'] },
    [VisualTheme.ARCTIC]: { segment: '#06b6d4', elimination: '#1e3a8a', particle: ['#ffffff', '#06b6d4'] },
  };

  const triggerEliminationEffect = (x: number, y: number, color: string = '#ef4444') => {
    shakeIntensityRef.current = 10; 
    flashesRef.current.push({ x, y, alpha: 0.8, size: 20, maxSize: 120 });
    for (let i = 0; i < 40; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 9;
      particlesRef.current.push({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1.2, maxLife: 1.2, color: i % 2 === 0 ? '#ffffff' : color, size: 2 + Math.random() * 5,
        alpha: 1
      });
    }
  };

  useEffect(() => {
    if (!canvasRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const engine = Engine.create({ 
      gravity: { x: 0, y: 1.6, scale: 0 }, 
      enableSleeping: false 
    });
    
    // Slow Motion: Set a lower timeScale for more cinematic physics (0.6 is a sweet spot)
    engine.timing.timeScale = 0.6;
    
    engineRef.current = engine;

    const render = Render.create({ 
      canvas: canvasRef.current, 
      engine, 
      options: { 
        width: CANVAS_SIZE, 
        height: CANVAS_SIZE, 
        wireframes: false, 
        background: 'transparent' 
      } 
    });

    const runner = Runner.create();
    runnerRef.current = runner;
    Render.run(render);

    const flags: Matter.Body[] = [];
    const baseSize = 22; 

    COUNTRIES.forEach((country) => {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * (CIRCLE_RADIUS * 0.4);
      const x = CENTER_X + Math.cos(angle) * dist;
      const y = CENTER_Y + Math.sin(angle) * dist;

      let flagBody: Matter.Body;
      
      const options = { 
        restitution: bounceIntensity, 
        friction: 0.05, 
        frictionAir: 0.018, // Slightly more air resistance for a dreamier "slow motion" feel
        label: 'Flag', 
        render: { visible: false }
      };

      if (flagShape === FlagShape.RECTANGLE) {
        flagBody = Bodies.rectangle(x, y, baseSize, baseSize * 0.67, options);
      } else {
        flagBody = Bodies.circle(x, y, baseSize / 2, options);
      }

      flags.push(flagBody);
      countriesRef.current.set(flagBody.id, country);
      
      const img = new Image();
      img.src = `https://flagcdn.com/w160/${country.code.toLowerCase()}.png`;
      textureCache.current.set(country.code, img);
    });

    Composite.add(engine.world, flags);
    setCountdown(3);

    Events.on(render, 'afterRender', () => {
      const ctx = render.context;
      const dt = 1/60;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      if (!paused) {
        particlesRef.current = particlesRef.current.filter(p => { 
          p.life -= dt; p.x += p.vx; p.y += p.vy; p.vy += 0.15; 
          p.alpha = Math.max(0, p.life / p.maxLife);
          return p.life > 0; 
        });
        flashesRef.current = flashesRef.current.filter(f => {
          f.alpha -= 0.05;
          f.size += (f.maxSize - f.size) * 0.15;
          return f.alpha > 0;
        });
        shakeIntensityRef.current *= 0.94;
        if (containerRef.current) {
          const sx = (Math.random() - 0.5) * shakeIntensityRef.current;
          const sy = (Math.random() - 0.5) * shakeIntensityRef.current;
          containerRef.current.style.transform = `translate(${sx}px, ${sy}px)`;
        }
      }

      flashesRef.current.forEach(f => {
        ctx.save();
        ctx.globalAlpha = f.alpha;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      });

      ctx.save();
      particlesRef.current.forEach(p => { 
        ctx.globalAlpha = p.alpha; ctx.fillStyle = p.color; 
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); 
      });
      ctx.restore();

      const allFlags = Composite.allBodies(engine.world).filter(b => countriesRef.current.has(b.id));
      allFlags.forEach(flag => {
        const country = countriesRef.current.get(flag.id);
        if (!country) return;
        const img = textureCache.current.get(country.code);
        if (!img?.complete) return;
        
        ctx.save();
        ctx.translate(flag.position.x, flag.position.y);
        ctx.rotate(flag.angle);
        
        let drawScale = 1;
        if (victoryFlagId === flag.id) {
          drawScale = 1 + victoryProgressRef.current * 6;
          ctx.save();
          ctx.rotate(-flag.angle + frameCountRef.current * 0.05);
          ctx.globalAlpha = 0.7 * victoryProgressRef.current;
          ctx.fillStyle = '#fbbf24';
          for(let i=0; i<16; i++) {
             ctx.rotate(Math.PI/8);
             ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-30 * drawScale, 300 * drawScale); ctx.lineTo(30 * drawScale, 300 * drawScale); ctx.fill();
          }
          ctx.restore();
        }

        const size = baseSize * drawScale;

        ctx.shadowBlur = 8;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowOffsetY = 2;
        
        if (flagShape === FlagShape.RECTANGLE) {
           const w = size;
           const h = size * 0.67;
           ctx.beginPath(); 
           ctx.rect(-w/2, -h/2, w, h); 
           ctx.clip();
           ctx.drawImage(img, -w/2, -h/2, w, h);
           ctx.restore(); 
           
           ctx.save();
           ctx.translate(flag.position.x, flag.position.y);
           ctx.rotate(flag.angle);
           ctx.strokeStyle = victoryFlagId === flag.id ? '#fbbf24' : 'white';
           ctx.lineWidth = victoryFlagId === flag.id ? 12 * drawScale : 3; 
           ctx.beginPath(); 
           ctx.rect(-w/2, -h/2, w, h); 
           ctx.stroke();
           ctx.restore();
        } else {
           ctx.beginPath(); ctx.arc(0, 0, size / 2, 0, Math.PI * 2); ctx.clip();
           ctx.drawImage(img, -size/2, -size/2, size, size);
           ctx.restore();
           
           ctx.save();
           ctx.translate(flag.position.x, flag.position.y);
           ctx.strokeStyle = victoryFlagId === flag.id ? '#fbbf24' : 'white';
           ctx.lineWidth = victoryFlagId === flag.id ? 12 * drawScale : 3; 
           ctx.beginPath(); ctx.arc(0, 0, size/2, 0, Math.PI * 2); ctx.stroke();
           ctx.restore();
        }
      });

      if (victoryFlagId) {
        victoryProgressRef.current = Math.min(1, victoryProgressRef.current + 0.007);
      }
    });

    return () => {
      Render.stop(render); 
      if (runnerRef.current) Runner.stop(runnerRef.current);
      Engine.clear(engine); 
      World.clear(engine.world, false);
    };
  }, []);

  useEffect(() => {
    if (!runnerRef.current || !engineRef.current) return;
    if (paused) Runner.stop(runnerRef.current);
    else Runner.run(runnerRef.current, engineRef.current);
  }, [paused]);

  useEffect(() => {
    if (!engineRef.current) return;
    const engine = engineRef.current;
    
    boundaryPartsRef.current.forEach(b => Composite.remove(engine.world, b));

    const parts: Matter.Body[] = [];
    const color = themeAssets[theme].segment;
    const VIRTUAL_GAP_START = Math.floor(SEGMENT_COUNT * 0.75);
    
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      if (i >= VIRTUAL_GAP_START && i < VIRTUAL_GAP_START + gapSize) continue;
      
      const t = i / SEGMENT_COUNT;
      const theta = t * Math.PI * 2;
      const x = Math.cos(theta) * CIRCLE_RADIUS;
      const y = Math.sin(theta) * CIRCLE_RADIUS;
      const angle = theta + Math.PI / 2;
      
      const rot = rotationRef.current;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const gx = CENTER_X + x * cos - y * sin;
      const gy = CENTER_Y + x * sin + y * cos;
      
      const seg = Bodies.rectangle(gx, gy, 28, 20, {
        isStatic: true, 
        angle: angle + rot, 
        restitution: 1.0, 
        friction: 0.05,
        render: { fillStyle: color }
      });
      parts.push(seg);
    }
    boundaryPartsRef.current = parts;
    Composite.add(engine.world, parts);

  }, [theme, gapSize, flagShape]);

  useEffect(() => {
    if (paused || countdown === null || status !== GameStatus.STARTING) return;
    
    const interval = 1200;
    const timer = setTimeout(() => { 
      const next = countdown - 1;
      if (next < 0) { 
        onStatusChange(GameStatus.PLAYING); 
        onCountdownTick?.(0);
        // Slow Motion: Reduce gravity scale further for that "floaty" impact
        if (engineRef.current) engineRef.current.gravity.scale = 0.0004; 
        setCountdown(null);
      } else {
        onCountdownTick?.(next);
        setCountdown(next);
      }
    }, interval); 
    
    return () => clearTimeout(timer);
  }, [paused, countdown, status]);

  useEffect(() => {
    if (countdown === 3 && status === GameStatus.STARTING) {
      onCountdownTick?.(3);
    }
  }, []);

  useEffect(() => {
    const engine = engineRef.current; if (!engine) return;
    const loop = () => {
      if (paused) return;
      frameCountRef.current++;
      
      if (status !== GameStatus.PLAYING) return;

      if (victoryFlagId === null) {
        rotationRef.current += omega; 
        
        boundaryPartsRef.current.forEach((part, i) => {
          const VIRTUAL_GAP_START = Math.floor(SEGMENT_COUNT * 0.75);
          
          let adjustedIndex = i;
          if (i >= VIRTUAL_GAP_START) {
            adjustedIndex = i + gapSize;
          }
          
          const t = adjustedIndex / SEGMENT_COUNT;
          const theta = t * Math.PI * 2;
          const lx = Math.cos(theta) * CIRCLE_RADIUS;
          const ly = Math.sin(theta) * CIRCLE_RADIUS;
          const la = theta + Math.PI / 2;
          
          const rot = rotationRef.current;
          const cos = Math.cos(rot);
          const sin = Math.sin(rot);
          const gx = CENTER_X + lx * cos - ly * sin;
          const gy = CENTER_Y + lx * sin + ly * cos;
          
          Body.setPosition(part, { x: gx, y: gy });
          Body.setAngle(part, la + rot);
        });

        const allBodies = Composite.allBodies(engine.world);
        const activeFlags = allBodies.filter(b => countriesRef.current.has(b.id) && b.label === 'Flag');

        if (onActiveUpdate && frameCountRef.current % 15 === 0) {
          const ranked = [...activeFlags].sort((a, b) => {
             const distA = Math.hypot(a.position.x - CENTER_X, a.position.y - CENTER_Y);
             const distB = Math.hypot(b.position.x - CENTER_X, b.position.y - CENTER_Y);
             return distA - distB;
          }).map(f => countriesRef.current.get(f.id)!);
          onActiveUpdate(ranked);
        }

        activeFlags.forEach(flag => {
          const distFromCenter = Math.hypot(flag.position.x - CENTER_X, flag.position.y - CENTER_Y);
          if (distFromCenter > 480 || flag.position.y > 950) {
            const country = countriesRef.current.get(flag.id);
            if (country) {
              if (targetWinnerId === country.code && activeFlags.length > 1) {
                Body.setPosition(flag, { x: CENTER_X, y: CENTER_Y });
                Body.setVelocity(flag, { x: 0, y: 0 });
                return;
              }
              
              triggerEliminationEffect(flag.position.x, flag.position.y, themeAssets[theme].elimination);
              onElimination(country); 
              Composite.remove(engine.world, flag);
            }
          }
        });

        if (activeFlags.length === 1 && !hasEndedRef.current) {
          const winner = countriesRef.current.get(activeFlags[0].id);
          if (winner) {
            hasEndedRef.current = true;
            setVictoryFlagId(activeFlags[0].id);
            Body.setStatic(activeFlags[0], true);
            shakeIntensityRef.current = 30; 
            
            onWinnerDetected?.(winner);
            
            setTimeout(() => onGameEnd(winner), 3500);
          }
        }
      }
    };
    Events.on(engine, 'afterUpdate', loop);
    return () => Events.off(engine, 'afterUpdate', loop);
  }, [status, paused, victoryFlagId, gapSize, targetWinnerId, theme, flagShape]);

  return (
    <div ref={containerRef} className="relative w-[800px] h-[800px] flex items-center justify-center will-change-transform">
      <div className="absolute inset-0 bg-blue-500/5 rounded-[100px] border-8 border-white/5 pointer-events-none shadow-[inset_0_0_150px_rgba(59,130,246,0.25)]" />
      <canvas ref={canvasRef} className="w-full h-full block relative z-10" />
      {countdown !== null && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
          <span className="text-[340px] font-black text-white drop-shadow-[0_0_140px_rgba(59,130,246,1)] animate-pulse-scale italic -translate-y-8">
            {countdown}
          </span>
        </div>
      )}
    </div>
  );
};

export default Game;

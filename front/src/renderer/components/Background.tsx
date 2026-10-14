// El fondo: degradé profundo, dos luces, una grilla tenue y partículas que
// suben despacio. Las partículas se apagan en Ajustes o si el sistema pide
// menos movimiento.

import { useEffect, useRef } from 'react';

import { useSettings } from '../store/settings';

const COUNT = 42;
const COLORS = ['0, 229, 255', '168, 85, 247', '191, 255, 0'];

interface Particle {
  x: number;
  y: number;
  r: number;
  speed: number;
  drift: number;
  color: string;
  phase: number;
}

function Particles() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;

    let width = 0;
    let height = 0;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      width = el.clientWidth;
      height = el.clientHeight;
      el.width = width * ratio;
      el.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const particles: Particle[] = Array.from({ length: COUNT }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 0.6 + Math.random() * 1.6,
      speed: 4 + Math.random() * 12,
      drift: (Math.random() - 0.5) * 6,
      color: COLORS[i % COLORS.length] ?? COLORS[0] ?? '0, 229, 255',
      phase: Math.random() * Math.PI * 2,
    }));

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.y -= p.speed * dt;
        p.x += p.drift * dt;
        if (p.y < -4) {
          p.y = height + 4;
          p.x = Math.random() * width;
        }
        const alpha = 0.25 + 0.35 * Math.sin(now / 1400 + p.phase) ** 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color}, ${alpha})`;
        ctx.shadowColor = `rgba(${p.color}, 0.8)`;
        ctx.shadowBlur = 6;
        ctx.fill();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvas} className="bg-particles" aria-hidden="true" />;
}

export function Background() {
  const particles = useSettings((s) => s.particles);
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <div className="bg" aria-hidden="true">
      <div className="bg-orb bg-orb-a" />
      <div className="bg-orb bg-orb-b" />
      <div className="bg-grid" />
      {particles && !reduced ? <Particles /> : null}
    </div>
  );
}

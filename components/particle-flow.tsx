"use client";

import { useEffect, useRef } from "react";

/**
 * 3D 벡터 파티클 플로우 — 로그인 배경 및 대시보드 Live Data 카드에서 공용으로
 * 쓰는 캔버스. 부모 요소 크기에 맞춰 그려지므로 풀스크린이든 카드 내부든
 * 그대로 재사용한다. 원본 수학(회전/투영/페이드)은 그대로 유지한다.
 */
export function ParticleFlow({
  className,
  strands = 120,
  pointsPerStrand = 250,
  color = "#ffffff",
  interactive = true,
  intensityRef,
}: {
  className?: string;
  strands?: number;
  pointsPerStrand?: number;
  color?: string;
  /** true면 마우스 이동에 따라 시점이 회전한다(풀스크린 배경용). */
  interactive?: boolean;
  /** 0~1+ 범위 외부 값 — 애니메이션 속도를 실시간으로 조절할 때 사용(예: 대시보드 처리량). */
  intensityRef?: React.MutableRefObject<number>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const fov = 600;
    let width = 0;
    let height = 0;
    let time = 0;
    let targetRotX = 0;
    let targetRotY = 0;
    let currentRotX = 0;
    let currentRotY = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas!.width = Math.max(1, width * dpr);
      canvas!.height = Math.max(1, height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function onMouseMove(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      const mx = e.clientX - rect.left - width / 2;
      const my = e.clientY - rect.top - height / 2;
      targetRotY = mx * 0.0005;
      targetRotX = my * 0.0005;
    }
    if (interactive) window.addEventListener("mousemove", onMouseMove);

    function rotate3D(x: number, y: number, z: number, rotX: number, rotY: number) {
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const x1 = x * cosY - z * sinY;
      const z1 = z * cosY + x * sinY;
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);
      const y1 = y * cosX - z1 * sinX;
      const z2 = z1 * cosX + y * sinX;
      return { x: x1, y: y1, z: z2 };
    }

    let raf = 0;
    function render() {
      ctx!.clearRect(0, 0, width, height);
      const intensity = intensityRef?.current ?? 1;
      time += 0.015 * (0.35 + Math.min(1.5, intensity) * 0.9);
      currentRotX += (targetRotX - currentRotX) * 0.05;
      currentRotY += (targetRotY - currentRotY) * 0.05;
      ctx!.fillStyle = color;

      for (let i = 0; i < strands; i++) {
        const v = i / strands - 0.5;
        const density = Math.sign(v) * Math.pow(Math.abs(v), 0.7);

        for (let j = 0; j < pointsPerStrand; j++) {
          const u = j / pointsPerStrand - 0.5;
          const xBase = u * width * 1.8;
          const xOffset = xBase * 0.002;

          const wave1Y = Math.sin(xOffset * 2 + time * 1.2) * 120;
          const wave1Z = Math.cos(xOffset * 2 + time * 1.2) * 120;

          const twistRadius = 150 + Math.sin(xOffset * 4 + time) * 50;
          const wave2Y =
            Math.sin(xOffset * 5 + density * Math.PI * 4 + time * 0.8) * twistRadius * density;
          const wave2Z =
            Math.cos(xOffset * 5 + density * Math.PI * 4 + time * 0.8) * twistRadius * density;

          const rawX = xBase;
          const rawY = wave1Y + wave2Y;
          const rawZ = wave1Z + wave2Z;

          const rotated = rotate3D(rawX, rawY, rawZ, currentRotX, currentRotY);
          const z = rotated.z + 300;
          if (z < -fov + 10) continue;

          const scale = fov / (fov + z);
          const px = rotated.x * scale + width / 2;
          const py = rotated.y * scale + height / 2;

          let edgeFade = 1 - Math.pow(Math.abs(u * 2), 2.5);
          if (edgeFade < 0) edgeFade = 0;
          const depthAlpha = Math.max(0.05, Math.min(1, 1 - z / 800));
          const finalAlpha = depthAlpha * edgeFade * 0.48;
          if (finalAlpha <= 0) continue;

          const size = Math.max(0.5, scale * 1.5);
          ctx!.globalAlpha = finalAlpha;
          ctx!.fillRect(px, py, size, size);
        }
      }

      raf = requestAnimationFrame(render);
    }
    raf = requestAnimationFrame(render);

    return () => {
      ro.disconnect();
      if (interactive) window.removeEventListener("mousemove", onMouseMove);
      cancelAnimationFrame(raf);
    };
  }, [strands, pointsPerStrand, color, interactive, intensityRef]);

  return <canvas ref={canvasRef} className={className} style={{ width: "100%", height: "100%", display: "block" }} />;
}

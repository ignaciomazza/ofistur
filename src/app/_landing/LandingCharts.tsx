"use client";

import type { ReactNode } from "react";

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun"];

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/20 p-5 shadow-md shadow-sky-950/10 transition-transform duration-200 hover:-translate-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-sky-950">{title}</p>
        <span className="text-[11px] text-sky-950/70">{subtitle}</span>
      </div>
      <div className="mt-3 h-40 w-full">{children}</div>
    </div>
  );
}

function AreaGraphic({
  id,
  label,
  points,
  color,
}: {
  id: string;
  label: string;
  points: number[];
  color: string;
}) {
  const x = (index: number) => 28 + index * 52;
  const line = points
    .map((y, index) => `${index ? "L" : "M"}${x(index)} ${y}`)
    .join(" ");
  const area = `${line} L${x(points.length - 1)} 128 L${x(0)} 128 Z`;

  return (
    <svg
      viewBox="0 0 320 160"
      className="size-full"
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.03" />
        </linearGradient>
      </defs>
      {[28, 61, 94, 127].map((y) => (
        <line key={y} x1="24" x2="292" y1={y} y2={y} stroke="#e5eef7" />
      ))}
      <path d={area} fill={`url(#${id})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {MONTHS.map((month, index) => (
        <text
          key={month}
          x={x(index)}
          y="152"
          textAnchor="middle"
          fill="#475569"
          fontSize="11"
        >
          {month}
        </text>
      ))}
    </svg>
  );
}

export function ChartVentasUp() {
  return (
    <ChartCard title="Más tiempo vendiendo" subtitle="+42% foco comercial">
      <AreaGraphic
        id="ventas-gradient"
        label="Horas útiles en ventas: tendencia creciente de enero a junio"
        points={[103, 91, 80, 66, 55, 35]}
        color="#0ea5e9"
      />
    </ChartCard>
  );
}

export function ChartAdminDown() {
  return (
    <ChartCard
      title="Menos trabajo repetitivo"
      subtitle="-55% tareas operativas"
    >
      <AreaGraphic
        id="admin-gradient"
        label="Horas en planillas y correcciones: tendencia decreciente de enero a junio"
        points={[37, 49, 65, 77, 89, 101]}
        color="#64748b"
      />
    </ChartCard>
  );
}

export function ChartControlEquipo() {
  return (
    <ChartCard title="Equipo alineado" subtitle="Visibilidad en tiempo real">
      <div className="relative flex size-full items-center justify-center">
        <svg
          viewBox="0 0 160 160"
          className="size-40"
          role="img"
          aria-label="92 por ciento de claridad operativa"
        >
          <circle
            cx="80"
            cy="80"
            r="55"
            fill="none"
            stroke="#e2e8f0"
            strokeWidth="16"
          />
          <circle
            cx="80"
            cy="80"
            r="55"
            fill="none"
            stroke="#0ea5e9"
            strokeWidth="16"
            strokeDasharray="318 346"
            strokeLinecap="round"
            transform="rotate(-90 80 80)"
          />
        </svg>
        <div
          className="pointer-events-none absolute text-center"
          aria-hidden="true"
        >
          <div className="text-2xl font-semibold text-sky-950">92%</div>
          <div className="text-[11px] text-sky-950/70">claridad operativa</div>
        </div>
      </div>
    </ChartCard>
  );
}

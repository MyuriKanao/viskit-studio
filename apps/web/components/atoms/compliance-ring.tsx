import * as React from 'react';

export interface ComplianceRingProps {
  score: number; // 0-100
  size?: number; // px
  className?: string;
}

function pickColor(score: number): string {
  if (score >= 80) return 'var(--success)';
  if (score >= 60) return 'var(--warning)';
  return 'var(--danger)';
}

export function ComplianceRing({ score, size = 48, className }: ComplianceRingProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);
  const color = pickColor(clamped);

  return (
    <svg
      role="img"
      aria-label={`Compliance score: ${clamped}%`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--surface-03)"
        strokeWidth={3}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset var(--t-std) var(--ease)' }}
      />
      <text
        x={size / 2}
        y={size / 2}
        dy="0.35em"
        textAnchor="middle"
        fill="var(--text-primary)"
        fontSize={size / 4}
        fontFamily="var(--font-sans)"
      >
        {clamped}
      </text>
    </svg>
  );
}

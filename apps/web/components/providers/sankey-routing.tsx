'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

import { ChipOverlay } from './chip-overlay';

export interface SankeyFlow {
  role: string;
  endpoint_id: string;
  latency_ms: number | null;
}

export interface SankeyRoutingProps {
  flows: SankeyFlow[];
  unbound: string[];
  className?: string;
}

const ROLES: { id: string; color: string }[] = [
  { id: 'vision', color: 'var(--info)' },
  { id: 'llm', color: 'var(--accent-soft)' },
  { id: 'image', color: 'var(--accent)' },
  { id: 'embedding', color: 'var(--success)' },
];

const VIEWBOX_W = 900;
const VIEWBOX_H = 380;
const LEFT_X = 200;
const RIGHT_X = VIEWBOX_W - 220;

function roleY(idx: number): number {
  return 40 + idx * 64;
}

export function SankeyRouting({ flows, unbound, className }: SankeyRoutingProps) {
  // Order endpoint bands by appearance to keep ribbon order stable.
  const endpointOrder = React.useMemo(() => {
    const seen: string[] = [];
    for (const f of flows) {
      if (!seen.includes(f.endpoint_id)) seen.push(f.endpoint_id);
    }
    return seen;
  }, [flows]);

  const endpointY = React.useCallback(
    (id: string) => {
      const i = endpointOrder.indexOf(id);
      if (i < 0) return 28;
      const slotCount = Math.max(endpointOrder.length, 1);
      const slot = (VIEWBOX_H - 80) / slotCount;
      return 28 + i * slot;
    },
    [endpointOrder]
  );

  const fixUrl = '/providers#routing';

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Active routing"
      className={cn('block h-auto w-full', className)}
    >
      <title>Active routing</title>
      {/* Role bands (left) */}
      {ROLES.map((role, i) => {
        const y = roleY(i);
        const isUnbound = unbound.includes(role.id);
        return (
          <g key={role.id} aria-label={`${role.id} band`}>
            <rect
              x={LEFT_X - 180}
              y={y}
              width={192}
              height={40}
              rx={10}
              fill="var(--surface-01)"
              stroke="var(--border-subtle)"
            />
            <rect x={LEFT_X - 180} y={y} width={2} height={40} fill={role.color} />
            <text
              x={LEFT_X - 166}
              y={y + 24}
              fontFamily="var(--font-mono)"
              fontSize={12}
              fill="var(--text-primary)"
            >
              {role.id}
            </text>
            {isUnbound ? (
              <ChipOverlay
                role={role.id}
                severity="warn"
                x={LEFT_X + 14}
                y={y + 6}
                onClickFixUrl={fixUrl}
              />
            ) : null}
          </g>
        );
      })}

      {/* Endpoint bands (right) */}
      {endpointOrder.map((id) => {
        const y = endpointY(id);
        return (
          <g key={id} aria-label={`endpoint ${id}`}>
            <rect
              x={RIGHT_X}
              y={y}
              width={200}
              height={32}
              rx={8}
              fill="var(--surface-02)"
              stroke="var(--border-subtle)"
            />
            <text
              x={RIGHT_X + 12}
              y={y + 20}
              fontFamily="var(--font-mono)"
              fontSize={11}
              fill="var(--text-primary)"
            >
              {id}
            </text>
          </g>
        );
      })}

      {/* Flow ribbons */}
      {flows.map((f, i) => {
        const roleIdx = ROLES.findIndex((r) => r.id === f.role);
        if (roleIdx < 0) return null;
        const yStart = roleY(roleIdx) + 20;
        const yEnd = endpointY(f.endpoint_id) + 16;
        const cx1 = LEFT_X + 140;
        const cx2 = RIGHT_X - 140;
        const d = `M ${LEFT_X + 12} ${yStart} C ${cx1} ${yStart}, ${cx2} ${yEnd}, ${RIGHT_X - 4} ${yEnd}`;
        const color = ROLES[roleIdx].color;
        return (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: positional ribbon
            key={i}
            d={d}
            stroke={color}
            strokeWidth={10}
            fill="none"
            strokeLinecap="round"
            opacity={0.6}
          />
        );
      })}
    </svg>
  );
}

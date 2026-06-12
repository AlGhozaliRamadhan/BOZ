'use client';

type BadgeVariant =
  | 'bull'
  | 'bear'
  | 'neutral'
  | 'cyan'
  | 'violet'
  | 'warning'
  | 'high'
  | 'medium'
  | 'low';

interface BadgeProps {
  label: string;
  variant: BadgeVariant;
}

export default function Badge({ label, variant }: BadgeProps) {
  return <span className={`badge badge-${variant}`}>{label}</span>;
}

'use client';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
  compact?: boolean;
  flush?: boolean;
}

export default function GlassCard({
  children,
  className,
  accent,
  compact,
  flush,
}: GlassCardProps) {
  const classes = [
    'glass-card',
    accent && 'accent-glow',
    compact && 'compact',
    flush && 'flush',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <div className={classes}>{children}</div>;
}

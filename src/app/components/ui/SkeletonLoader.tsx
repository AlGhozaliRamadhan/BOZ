'use client';

interface SkeletonLoaderProps {
  type: 'text' | 'title' | 'card' | 'circle';
  width?: string;
  count?: number;
}

const typeClassMap: Record<string, string> = {
  text: 'skeleton skeleton-text',
  title: 'skeleton skeleton-title',
  card: 'skeleton skeleton-card',
  circle: 'skeleton skeleton-circle',
};

export default function SkeletonLoader({ type, width, count = 1 }: SkeletonLoaderProps) {
  const items = Array.from({ length: count }, (_, i) => i);
  const circleSize = width ?? '40px';

  return (
    <>
      {items.map((i) => (
        <div
          key={i}
          className={typeClassMap[type]}
          style={
            type === 'circle'
              ? { width: circleSize, height: circleSize }
              : width
                ? { width }
                : undefined
          }
        />
      ))}
    </>
  );
}

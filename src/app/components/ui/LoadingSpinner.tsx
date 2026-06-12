'use client';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
}

const sizeClassMap: Record<string, string> = {
  sm: 'spinner spinner-sm',
  md: 'spinner',
  lg: 'spinner spinner-lg',
};

export default function LoadingSpinner({ size = 'md', text }: LoadingSpinnerProps) {
  return (
    <div className="loading-overlay">
      <div className={sizeClassMap[size]} />
      {text && <span>{text}</span>}
    </div>
  );
}

import type { ReactNode } from 'react';

interface GlassCardProps {
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}

export function GlassCard({ className = '', children, onClick }: GlassCardProps) {
  return (
    <div
      className={`rounded-2xl ${className}`}
      style={{
        background: 'rgba(255, 255, 255, 0.7)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.3)',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
      }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

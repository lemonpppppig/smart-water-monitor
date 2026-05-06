import type { ReactNode } from 'react';

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string | number;
  color?: string;
  suffix?: string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: string;
}

export function StatCard({ 
  icon, 
  label, 
  value, 
  color = 'text-cyan-500',
  suffix,
}: StatCardProps) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: 'rgba(255, 255, 255, 0.7)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.3)',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
      }}
    >
      <div className="flex items-center gap-3">
        <div className={`text-2xl ${color}`}>
          {icon}
        </div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-semibold text-gray-900">
            {value}
            {suffix && <span className="text-sm font-normal text-gray-500 ml-1">{suffix}</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

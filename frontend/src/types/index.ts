// 全局类型定义

export interface Station {
  id: string;
  station_code: string;
  station_name: string;
  station_type: string;
  status: string;
  longitude: number;
  latitude: number;
  address?: string;
  created_at: string;
}

export interface Alert {
  id: string;
  alert_code: string;
  station_id: string;
  alert_type: string;
  alert_level: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description?: string;
  status: string;
  created_at: string;
}

export interface AlertRule {
  id: string;
  rule_name: string;
  rule_type: string;
  alert_level: string;
  is_enabled: boolean;
}

export interface AgentStatus {
  agent_name: string;
  agent_type: string;
  status: 'online' | 'offline' | 'busy' | 'error';
  current_task?: string;
  capabilities: string[];
}

export interface SystemStatus {
  system_mode: 'normal' | 'alert' | 'emergency';
  active_agents: number;
  total_agents: number;
  pending_tasks: number;
  running_tasks: number;
  active_alerts: number;
}

export interface AgentTask {
  task_id: string;
  task_type: string;
  priority: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  assigned_to?: string;
  created_at: string;
  completed_at?: string;
  result?: any;
}

export interface Report {
  id: string;
  report_code: string;
  report_type: string;
  report_name: string;
  status: string;
  file_format: string;
  created_at: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  role: string;
}

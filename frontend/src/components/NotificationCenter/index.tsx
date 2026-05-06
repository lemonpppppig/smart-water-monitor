import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BellOutlined,
  AlertOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
  RobotOutlined,
  SettingOutlined,
  DeleteOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { Popover, Badge, Tabs, Button, Empty } from 'antd';

interface Notification {
  id: string;
  type: 'alert' | 'ai' | 'system' | 'success';
  title: string;
  content: string;
  timestamp: Date;
  read: boolean;
  priority: 'critical' | 'high' | 'medium' | 'low';
  action?: {
    type: 'link' | 'dialog';
    target: string;
    label: string;
  };
}

// 模拟通知数据
const mockNotifications: Notification[] = [
  {
    id: '1',
    type: 'alert',
    title: '【紧急预警】站点E 总磷超标',
    content: '当前值 0.35mg/L，超标 17%，建议立即启动应急响应',
    timestamp: new Date(Date.now() - 5 * 60 * 1000),
    read: false,
    priority: 'critical',
    action: { type: 'link', target: '/alerts/5', label: '查看详情' },
  },
  {
    id: '2',
    type: 'ai',
    title: '【AI分析】上游污染溯源完成',
    content: '站点A异常已定位至上游工业园区，置信度92%',
    timestamp: new Date(Date.now() - 15 * 60 * 1000),
    read: false,
    priority: 'high',
    action: { type: 'link', target: '/alerts/1', label: '查看分析' },
  },
  {
    id: '3',
    type: 'alert',
    title: '【高级预警】站点A pH值异常',
    content: '当前pH值 9.2，超过标准上限',
    timestamp: new Date(Date.now() - 30 * 60 * 1000),
    read: false,
    priority: 'high',
    action: { type: 'link', target: '/alerts/1', label: '查看详情' },
  },
  {
    id: '4',
    type: 'ai',
    title: '【处置跟踪】站点B恢复正常',
    content: '溶解氧已恢复至 7.2mg/L，处置措施有效',
    timestamp: new Date(Date.now() - 60 * 60 * 1000),
    read: true,
    priority: 'low',
  },
  {
    id: '5',
    type: 'system',
    title: '日报已自动生成',
    content: '2024年3月14日水质监测日报已生成',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
    read: true,
    priority: 'low',
    action: { type: 'link', target: '/reports', label: '查看报告' },
  },
  {
    id: '6',
    type: 'success',
    title: '预警已处理完成',
    content: '站点C氨氮超标事件已标记为已解决',
    timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000),
    read: true,
    priority: 'low',
  },
];

const typeConfig: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  alert: { icon: <AlertOutlined />, color: 'text-red-500', bg: 'bg-red-50' },
  ai: { icon: <RobotOutlined />, color: 'text-cyan-500', bg: 'bg-cyan-50' },
  system: { icon: <InfoCircleOutlined />, color: 'text-blue-500', bg: 'bg-blue-50' },
  success: { icon: <CheckCircleOutlined />, color: 'text-green-500', bg: 'bg-green-50' },
};

const priorityConfig: Record<string, { dot: string; text: string }> = {
  critical: { dot: 'bg-red-500', text: '紧急' },
  high: { dot: 'bg-orange-500', text: '高' },
  medium: { dot: 'bg-yellow-500', text: '中' },
  low: { dot: 'bg-gray-400', text: '低' },
};

function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  return `${days}天前`;
}

interface NotificationItemProps {
  notification: Notification;
  onRead: (id: string) => void;
  onAction: (notification: Notification) => void;
}

function NotificationItem({ notification, onRead, onAction }: NotificationItemProps) {
  const config = typeConfig[notification.type];
  const priority = priorityConfig[notification.priority];

  return (
    <div
      className={`p-3 border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors ${
        !notification.read ? 'bg-blue-50/30' : ''
      }`}
      onClick={() => {
        onRead(notification.id);
        if (notification.action) {
          onAction(notification);
        }
      }}
    >
      <div className="flex gap-3">
        {/* Icon */}
        <div
          className={`w-9 h-9 rounded-lg ${config.bg} ${config.color} flex items-center justify-center flex-shrink-0`}
        >
          {config.icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className={`text-sm font-medium truncate ${!notification.read ? 'text-gray-900' : 'text-gray-600'}`}>
              {notification.title}
            </h4>
            {!notification.read && notification.priority !== 'low' && (
              <span className={`w-1.5 h-1.5 rounded-full ${priority.dot}`} />
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{notification.content}</p>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs text-gray-400">{formatTime(notification.timestamp)}</span>
            {notification.action && (
              <span className="text-xs text-cyan-600 hover:text-cyan-700">
                {notification.action.label} →
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NotificationCenter() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>(mockNotifications);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('all');

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const handleReadAll = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const handleClearAll = () => {
    setNotifications([]);
  };

  const handleAction = (notification: Notification) => {
    if (notification.action?.type === 'link') {
      navigate(notification.action.target);
      setOpen(false);
    }
  };

  const filteredNotifications = notifications.filter((n) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'unread') return !n.read;
    if (activeTab === 'alert') return n.type === 'alert';
    if (activeTab === 'ai') return n.type === 'ai';
    return true;
  });

  const content = (
    <div className="w-96">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900">通知中心</h3>
        <div className="flex items-center gap-2">
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            onClick={handleReadAll}
            className="text-gray-500 hover:text-cyan-600"
          >
            全部已读
          </Button>
          <Button
            type="text"
            size="small"
            icon={<SettingOutlined />}
            className="text-gray-500 hover:text-gray-700"
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        className="px-4"
        size="small"
        items={[
          { key: 'all', label: '全部' },
          { key: 'unread', label: `未读 (${unreadCount})` },
          { key: 'alert', label: '预警' },
          { key: 'ai', label: 'AI消息' },
        ]}
      />

      {/* Notification List */}
      <div className="max-h-96 overflow-y-auto">
        {filteredNotifications.length > 0 ? (
          filteredNotifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onRead={handleRead}
              onAction={handleAction}
            />
          ))
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无通知"
            className="py-8"
          />
        )}
      </div>

      {/* Footer */}
      {notifications.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 bg-gray-50">
          <Button
            type="text"
            size="small"
            onClick={() => {
              navigate('/alerts');
              setOpen(false);
            }}
            className="text-cyan-600 hover:text-cyan-700"
          >
            查看所有预警
          </Button>
          <Button
            type="text"
            size="small"
            icon={<DeleteOutlined />}
            onClick={handleClearAll}
            className="text-gray-400 hover:text-red-500"
          >
            清空
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
      overlayClassName="notification-popover"
      arrow={false}
    >
      <Badge count={unreadCount} size="small" offset={[-2, 2]}>
        <button className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors relative">
          <BellOutlined className="text-lg" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          )}
        </button>
      </Badge>
    </Popover>
  );
}

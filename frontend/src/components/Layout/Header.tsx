import { useLocation } from 'react-router-dom';
import {
  SearchOutlined,
  QuestionCircleOutlined,
  FullscreenOutlined,
  UserOutlined,
  DownOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { Dropdown, Input, Tooltip } from 'antd';
import NotificationCenter from '../NotificationCenter';
import { useUIStore } from '../../store';

const breadcrumbMap: Record<string, string> = {
  '/': '首页',
  '/dashboard': '监测大屏',
  '/stations': '站点管理',
  '/alerts': '预警中心',
  '/alert-rules': '预警规则',
  '/agents': '智能体管理',
  '/graph': '图管理',
  '/graph/pollution-sources': '污染源管理',
  '/graph/river-topology': '河流拓扑',
  '/knowledge': '知识库',
  '/reports': '报告管理',
  '/settings': '系统设置',
};

const userMenuItems = [
  { key: 'profile', label: '个人设置' },
  { key: 'password', label: '修改密码' },
  { type: 'divider' as const },
  { key: 'logout', label: '退出登录' },
];

export function Header() {
  const location = useLocation();
  const demoMode = useUIStore((s) => s.demoMode);
  const toggleDemoMode = useUIStore((s) => s.toggleDemoMode);
  
  // 动态获取页面标题
  const getPageTitle = () => {
    const path = location.pathname;
    // 精确匹配
    if (breadcrumbMap[path]) return breadcrumbMap[path];
    // 预警详情页
    if (path.startsWith('/alerts/')) return '预警详情 - AI分析';
    // 站点详情页
    if (path.startsWith('/stations/')) return '站点详情';
    // 案例详情页
    if (path.startsWith('/knowledge/cases/')) return '案例详情';
    return '页面';
  };

  const currentTitle = getPageTitle();

  return (
    <header
      className="h-16 flex items-center justify-between px-6 sticky top-0 z-40"
      style={{
        background: 'rgba(255, 255, 255, 0.8)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(0, 0, 0, 0.06)',
      }}
    >
      {/* Left: Breadcrumb */}
      <div className="flex items-center">
        <h1 className="text-xl font-semibold text-gray-900">{currentTitle}</h1>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="relative mr-2">
          <SearchOutlined className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="全局搜索..."
            className="w-64 pl-10 rounded-lg border-gray-200 focus:border-cyan-500 focus:ring-cyan-500"
            style={{ background: 'rgba(255, 255, 255, 0.6)' }}
          />
        </div>

        {/* Help */}
        <button className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors">
          <QuestionCircleOutlined className="text-lg" />
        </button>

        {/* Fullscreen */}
        <button className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors">
          <FullscreenOutlined className="text-lg" />
        </button>

        {/* Demo / Normal Mode Switch */}
        <Tooltip title={demoMode ? '演示模式：地名已脱敏（点击切换到正常模式）' : '正常模式（点击切换到演示模式）'}>
          <button
            onClick={toggleDemoMode}
            className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
              demoMode
                ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }`}
          >
            {demoMode ? <EyeInvisibleOutlined className="text-lg" /> : <EyeOutlined className="text-lg" />}
          </button>
        </Tooltip>

        {/* Notifications */}
        <NotificationCenter />

        {/* User */}
        <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
          <button className="flex items-center gap-2 ml-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
              <UserOutlined className="text-white text-sm" />
            </div>
            <span className="text-sm font-medium text-gray-700">管理员</span>
            <DownOutlined className="text-xs text-gray-400" />
          </button>
        </Dropdown>
      </div>
    </header>
  );
}

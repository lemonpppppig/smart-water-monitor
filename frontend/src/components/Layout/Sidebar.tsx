import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  HomeOutlined,
  DashboardOutlined,
  EnvironmentOutlined,
  BellOutlined,
  SafetyOutlined,
  FileTextOutlined,
  SettingOutlined,
  BookOutlined,
  DownOutlined,
  RightOutlined,
  NodeIndexOutlined,
  BranchesOutlined,
  ApartmentOutlined,
  LineChartOutlined,
  AppstoreOutlined,
  ApiOutlined,
  DatabaseOutlined,
  RobotOutlined,
  ExperimentOutlined,
  ToolOutlined,
  UserOutlined,
  HistoryOutlined,
  CloudServerOutlined,
  RadarChartOutlined,
  ClusterOutlined,
} from '@ant-design/icons';

interface ChildItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface MenuItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: ChildItem[];
}

// 5 大模块 - 运行态势 / 监测站点 / 预警与处置 / AI与图谱 / 知识与报告 / 系统管理
const menuItems: MenuItem[] = [
  {
    path: '/overview',
    label: '运行态势',
    icon: DashboardOutlined,
    children: [
      { path: '/', label: '首页门户', icon: HomeOutlined },
      { path: '/dashboard', label: '监测大屏', icon: RadarChartOutlined },
    ],
  },
  {
    path: '/assets',
    label: '监测站点',
    icon: EnvironmentOutlined,
    children: [
      { path: '/stations', label: '站点中心', icon: EnvironmentOutlined },
      { path: '/system/mqtt/data', label: '实时数据', icon: DatabaseOutlined },
    ],
  },
  {
    path: '/alerts',
    label: '预警与处置',
    icon: BellOutlined,
    children: [
      { path: '/alerts', label: '预警中心', icon: BellOutlined },
      { path: '/alerts/analysis', label: '智能分析', icon: RadarChartOutlined },
      { path: '/disposal', label: '响应处置', icon: ToolOutlined },
      { path: '/alerts/rules', label: '预警规则', icon: SafetyOutlined },
    ],
  },
  {
    path: '/ai',
    label: 'AI 与图谱',
    icon: RobotOutlined,
    children: [
      { path: '/ai/prediction', label: '预测分析', icon: LineChartOutlined },
      { path: '/ai/graph', label: '水系图谱', icon: ApartmentOutlined },
      { path: '/ai/graph/admin', label: '图谱管理', icon: ClusterOutlined },
      { path: '/ai/agents', label: '智能体', icon: RobotOutlined },
      { path: '/ai/models', label: '模型管理', icon: AppstoreOutlined },
    ],
  },
  {
    path: '/knowledge-reports',
    label: '知识与报告',
    icon: BookOutlined,
    children: [
      { path: '/knowledge', label: '知识库', icon: BookOutlined },
      { path: '/reports', label: '报告管理', icon: FileTextOutlined },
    ],
  },
  {
    path: '/system',
    label: '系统管理',
    icon: SettingOutlined,
    children: [
      { path: '/system/mqtt', label: 'MQTT 连接', icon: ApiOutlined },
      { path: '/system/users', label: '用户与权限', icon: UserOutlined },
      { path: '/system/params', label: '系统参数', icon: CloudServerOutlined },
      { path: '/system/logs', label: '日志与备份', icon: HistoryOutlined },
    ],
  },
];

export function Sidebar() {
  const location = useLocation();

  // 根据当前路径自动展开匹配的一级菜单
  const getInitialExpanded = () => {
    const matched = menuItems
      .filter((item) => item.children && item.children.some((c) => matchChild(c.path, location.pathname)))
      .map((item) => item.path);
    return matched.length > 0 ? matched : ['/overview'];
  };

  const [expandedMenus, setExpandedMenus] = useState<string[]>(getInitialExpanded);

  useEffect(() => {
    // 路由切换时保持当前组自动展开
    const next = menuItems
      .filter((item) => item.children && item.children.some((c) => matchChild(c.path, location.pathname)))
      .map((item) => item.path);
    if (next.length > 0) {
      setExpandedMenus((prev) => Array.from(new Set([...prev, ...next])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const toggleMenu = (path: string) => {
    setExpandedMenus((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };

  // 计算每个分组内"最长前缀胜出"的激活子项路径，避免 /alerts 与 /alerts/rules 同时高亮
  const activeChildByGroup: Record<string, string | null> = {};
  menuItems.forEach((item) => {
    if (item.children) {
      activeChildByGroup[item.path] = pickBestChild(item.children.map((c) => c.path), location.pathname);
    }
  });

  const isMenuActive = (item: MenuItem) => {
    if (item.children) {
      return activeChildByGroup[item.path] !== null;
    }
    return matchChild(item.path, location.pathname);
  };

  return (
    <aside
      className="fixed left-0 top-0 h-screen w-[240px] flex flex-col z-50"
      style={{
        background: 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRight: '1px solid rgba(0, 0, 0, 0.06)',
      }}
    >
      {/* Logo Area */}
      <div className="h-16 flex items-center px-6 border-b border-gray-100">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center mr-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C12 2 6 8 6 13C6 16.3137 8.68629 19 12 19C15.3137 19 18 16.3137 18 13C18 8 12 2 12 2Z" fill="white" />
            <path d="M12 22C15.866 22 19 18.866 19 15H5C5 18.866 8.13401 22 12 22Z" fill="white" fillOpacity="0.6" />
          </svg>
        </div>
        <span className="text-lg font-semibold text-gray-900">水环境智测</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 overflow-y-auto">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = isMenuActive(item);
          const hasChildren = item.children && item.children.length > 0;
          const isExpanded = expandedMenus.includes(item.path);

          return (
            <div key={item.path}>
              {hasChildren ? (
                <>
                  <div
                    onClick={() => toggleMenu(item.path)}
                    className={`
                      flex items-center px-4 py-3 mb-1 rounded-xl transition-all duration-200 cursor-pointer group
                      ${isActive ? 'bg-cyan-50 text-cyan-600' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}
                    `}
                    style={{ position: 'relative' }}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-cyan-500 rounded-r-full" />
                    )}
                    <Icon className={`text-lg mr-3 transition-colors duration-200 ${isActive ? 'text-cyan-500' : 'text-gray-400 group-hover:text-gray-600'}`} />
                    <span className="font-medium text-sm flex-1">{item.label}</span>
                    {isExpanded ? <DownOutlined className="text-xs text-gray-400" /> : <RightOutlined className="text-xs text-gray-400" />}
                  </div>
                  {isExpanded && (
                    <div className="ml-4 border-l border-gray-100 pl-2">
                      {item.children?.map((child) => {
                        const ChildIcon = child.icon;
                        const isChildActive = activeChildByGroup[item.path] === child.path;
                        return (
                          <Link
                            key={child.path}
                            to={child.path}
                            className={`
                              flex items-center px-4 py-2.5 mb-0.5 rounded-lg transition-all duration-200 group
                              ${isChildActive ? 'bg-cyan-50 text-cyan-600' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'}
                            `}
                          >
                            <ChildIcon className={`text-sm mr-2.5 transition-colors duration-200 ${isChildActive ? 'text-cyan-500' : 'text-gray-400 group-hover:text-gray-500'}`} />
                            <span className="text-sm">{child.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <Link
                  to={item.path}
                  className={`
                    flex items-center px-4 py-3 mb-1 rounded-xl transition-all duration-200 group
                    ${isActive ? 'bg-cyan-50 text-cyan-600' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}
                  `}
                  style={{ position: 'relative' }}
                >
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-cyan-500 rounded-r-full" />
                  )}
                  <Icon className={`text-lg mr-3 transition-colors duration-200 ${isActive ? 'text-cyan-500' : 'text-gray-400 group-hover:text-gray-600'}`} />
                  <span className="font-medium text-sm">{item.label}</span>
                  {isActive && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-cyan-500" />
                  )}
                </Link>
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom Area */}
      <div className="p-4 border-t border-gray-100">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>版本 v1.0.0</span>
          <span className="flex items-center">
            <span className="w-2 h-2 rounded-full bg-green-500 mr-1.5" />
            运行中
          </span>
        </div>
      </div>
    </aside>
  );
}

// 子项路径匹配：完全相等，或为子路径前缀（要求下一个字符是 /，避免 /a 误配 /ab）
function matchChild(childPath: string, pathname: string): boolean {
  if (childPath === '/') return pathname === '/';
  if (childPath === pathname) return true;
  return pathname.startsWith(childPath + '/');
}

// 从一组同级路径中挑出"与当前 pathname 匹配且最长"的那个（没有则返回 null）
function pickBestChild(paths: string[], pathname: string): string | null {
  let best: string | null = null;
  for (const p of paths) {
    if (!matchChild(p, pathname)) continue;
    if (best === null || p.length > best.length) best = p;
  }
  return best;
}

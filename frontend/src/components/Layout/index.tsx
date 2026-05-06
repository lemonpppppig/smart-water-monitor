import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import AIChat from '../AIChat';

export default function Layout() {
  const location = useLocation();
  const isDashboard = location.pathname === '/dashboard';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <div className="ml-[240px] h-screen flex flex-col overflow-hidden">
        {/* Header 始终显示，避免大屏把顶栏吃掉 */}
        <Header />

        {/* Page Content：大屏模式下不加 padding、不滚动 */}
        <main className={isDashboard ? 'flex-1 relative overflow-hidden' : 'flex-1 p-6 overflow-y-auto'}>
          <Outlet />
        </main>
      </div>

      {/* AI Chat - 全局悬浮 */}
      <AIChat />
    </div>
  );
}

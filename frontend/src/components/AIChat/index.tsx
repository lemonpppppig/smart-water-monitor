import { useState, useRef, useEffect } from 'react';
import {
  RobotOutlined,
  SendOutlined,
  CloseOutlined,
  MinusOutlined,
  ExpandOutlined,
  LoadingOutlined,
  UserOutlined,
  BulbOutlined,
  EnvironmentOutlined,
  AlertOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import { Input, Button, Tooltip, Badge } from 'antd';

const { TextArea } = Input;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  loading?: boolean;
  sources?: { type: string; name: string }[];
}

interface QuickAction {
  icon: React.ReactNode;
  label: string;
  prompt: string;
}

const quickActions: QuickAction[] = [
  { icon: <AlertOutlined />, label: '当前预警', prompt: '当前有哪些预警需要关注？' },
  { icon: <EnvironmentOutlined />, label: '站点状态', prompt: '各监测站点当前运行状态如何？' },
  { icon: <BulbOutlined />, label: '异常分析', prompt: '请分析最近的异常数据并给出建议' },
  { icon: <QuestionCircleOutlined />, label: '处置建议', prompt: '针对当前预警，有什么处置建议？' },
];

// 模拟 AI 响应
const mockAIResponse = (userMessage: string): Promise<{ content: string; sources?: { type: string; name: string }[] }> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (userMessage.includes('预警')) {
        resolve({
          content: `**当前预警概览**\n\n目前共有 **3** 条活跃预警：\n\n1. 🔴 **紧急** - 站点E 总磷超标\n   - 当前值：0.35 mg/L（超标 17%）\n   - 持续时间：2小时\n   - 建议：立即启动应急响应\n\n2. 🟠 **高级** - 站点A pH值异常\n   - 当前值：9.2（超标准上限）\n   - 可能原因：上游工业排放\n\n3. 🟡 **中级** - 站点B 溶解氧偏低\n   - 当前值：5.8 mg/L\n   - 建议：加强监测频率\n\n需要我详细分析某条预警吗？`,
          sources: [
            { type: '时序引擎', name: '异常检测' },
            { type: '知识引擎', name: '预警规则' },
          ],
        });
      } else if (userMessage.includes('站点') || userMessage.includes('状态')) {
        resolve({
          content: `**站点运行状态**\n\n📊 在线统计：\n- 总站点数：128\n- 在线：126（98.4%）\n- 离线：1\n- 维护中：1\n\n⚠️ 需要关注的站点：\n\n1. **站点D** - 离线\n   - 离线时长：45分钟\n   - 最后数据：14:30\n   - 建议：检查网络连接和设备供电\n\n2. **站点E** - 在线但异常\n   - 总磷持续超标\n   - 建议：核实周边污染源\n\n需要查看具体站点的详细数据吗？`,
          sources: [
            { type: '数据服务', name: '站点状态' },
          ],
        });
      } else if (userMessage.includes('分析') || userMessage.includes('异常')) {
        resolve({
          content: `**异常数据分析报告**\n\n🔍 **分析结果**\n\n基于最近24小时的监测数据，我发现以下异常模式：\n\n**1. 站点A pH值波动**\n- 异常时段：14:00 - 16:00\n- 异常特征：pH值从7.2急升至9.2\n- 置信度：92%\n\n**2. 溯源分析**\n- 上游关联站点：站点B\n- 可能污染源：工业园区排污口（距离2.3km）\n- 传输时间估计：约1.5小时\n\n**3. 风险评估**\n- 当前风险等级：中高\n- 下游影响范围：2个站点\n- 预计影响时间：3小时内\n\n📋 **建议措施**\n1. 联系工业园区管理方核实排放情况\n2. 对站点A加密监测至每15分钟\n3. 通知下游站点做好应急准备`,
          sources: [
            { type: '时序引擎', name: '异常检测' },
            { type: '图引擎', name: '溯源分析' },
            { type: '知识引擎', name: '风险评估' },
          ],
        });
      } else if (userMessage.includes('处置') || userMessage.includes('建议')) {
        resolve({
          content: `**处置建议**\n\n基于当前预警情况，建议采取以下措施：\n\n**针对站点E总磷超标：**\n\n🔹 **即时措施**\n1. 启动应急监测，提高采样频率至每30分钟\n2. 通知环保执法人员现场排查\n3. 对上游3km范围内的排污口进行检查\n\n🔹 **处置流程**\n1. 确认污染源位置\n2. 责令违规企业停止排放\n3. 启动应急处理（投加絮凝剂）\n4. 持续监测直至指标恢复正常\n\n🔹 **预计恢复时间**\n- 若及时处置：6-8小时\n- 自然恢复：24-48小时\n\n📎 相关预案：《总磷超标应急处置预案》\n\n是否需要生成详细的处置报告？`,
          sources: [
            { type: '知识引擎', name: '应急预案' },
            { type: '知识引擎', name: '案例匹配' },
          ],
        });
      } else {
        resolve({
          content: `我是水环境AI助手，可以帮您：\n\n1. 📊 **实时监控** - 查看站点状态和数据\n2. 🔔 **预警分析** - 分析当前预警情况\n3. 🔍 **异常诊断** - 检测和解释异常数据\n4. 🌊 **溯源追踪** - 分析污染来源和传播路径\n5. 💡 **处置建议** - 提供专业的处置方案\n6. 📝 **报告生成** - 生成分析报告\n\n请问有什么可以帮您的？`,
          sources: [],
        });
      }
    }, 1500);
  });
};

interface AIChatProps {
  defaultOpen?: boolean;
  context?: { type: string; id?: string; title?: string };
}

export default function AIChat({ defaultOpen = false, context }: AIChatProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: '您好！我是水环境AI助手 🌊\n\n我可以帮您分析水质数据、诊断异常、追踪污染源、提供处置建议。\n\n有什么可以帮您的吗？',
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 处理上下文
  useEffect(() => {
    if (context && isOpen) {
      // 可以自动发送上下文相关的消息
      // 例如: setInputValue(`请分析${context.type}：${context.title || context.id}`);
    }
  }, [context, isOpen]);

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    // 添加加载消息
    const loadingMessage: Message = {
      id: 'loading',
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      loading: true,
    };
    setMessages((prev) => [...prev, loadingMessage]);

    try {
      const response = await mockAIResponse(userMessage.content);
      
      // 移除加载消息，添加真实响应
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== 'loading');
        return [
          ...filtered,
          {
            id: Date.now().toString(),
            role: 'assistant',
            content: response.content,
            timestamp: new Date(),
            sources: response.sources,
          },
        ];
      });
    } catch {
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== 'loading');
        return [
          ...filtered,
          {
            id: Date.now().toString(),
            role: 'assistant',
            content: '抱歉，处理请求时出现错误，请稍后重试。',
            timestamp: new Date(),
          },
        ];
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickAction = (prompt: string) => {
    setInputValue(prompt);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 悬浮按钮
  if (!isOpen) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <Tooltip title="AI 助手" placement="left">
          <Badge count={0} offset={[-5, 5]}>
            <button
              onClick={() => setIsOpen(true)}
              className="w-14 h-14 rounded-full bg-gradient-to-br from-cyan-500 to-cyan-600 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 flex items-center justify-center group"
            >
              <RobotOutlined className="text-2xl group-hover:scale-110 transition-transform" />
            </button>
          </Badge>
        </Tooltip>
      </div>
    );
  }

  // 最小化状态
  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <div
          className="bg-white rounded-full shadow-lg px-4 py-2 flex items-center gap-3 cursor-pointer hover:shadow-xl transition-shadow"
          onClick={() => setIsMinimized(false)}
        >
          <RobotOutlined className="text-cyan-500 text-xl" />
          <span className="text-sm font-medium text-gray-700">AI 助手</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
              setIsMinimized(false);
            }}
            className="text-gray-400 hover:text-gray-600"
          >
            <CloseOutlined />
          </button>
        </div>
      </div>
    );
  }

  // 完整对话窗口
  const windowClass = isExpanded
    ? 'fixed inset-4 z-50'
    : 'fixed bottom-6 right-6 w-96 h-[600px] z-50';

  return (
    <div className={windowClass}>
      <div
        className="h-full bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{
          border: '1px solid rgba(0, 0, 0, 0.05)',
        }}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-cyan-500 to-cyan-600 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <RobotOutlined className="text-white text-xl" />
            </div>
            <div>
              <h3 className="text-white font-semibold">水环境 AI 助手</h3>
              <p className="text-white/70 text-xs">随时为您分析和解答</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsMinimized(true)}
              className="w-8 h-8 rounded-lg hover:bg-white/20 text-white flex items-center justify-center transition-colors"
            >
              <MinusOutlined />
            </button>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="w-8 h-8 rounded-lg hover:bg-white/20 text-white flex items-center justify-center transition-colors"
            >
              <ExpandOutlined />
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="w-8 h-8 rounded-lg hover:bg-white/20 text-white flex items-center justify-center transition-colors"
            >
              <CloseOutlined />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              {/* Avatar */}
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  message.role === 'user'
                    ? 'bg-cyan-500 text-white'
                    : 'bg-gradient-to-br from-cyan-400 to-cyan-600 text-white'
                }`}
              >
                {message.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
              </div>

              {/* Content */}
              <div
                className={`max-w-[80%] ${
                  message.role === 'user' ? 'text-right' : ''
                }`}
              >
                <div
                  className={`rounded-2xl px-4 py-3 ${
                    message.role === 'user'
                      ? 'bg-cyan-500 text-white rounded-tr-sm'
                      : 'bg-white shadow-sm rounded-tl-sm'
                  }`}
                >
                  {message.loading ? (
                    <div className="flex items-center gap-2 text-gray-500">
                      <LoadingOutlined className="animate-spin" />
                      <span>正在分析...</span>
                    </div>
                  ) : (
                    <div
                      className={`text-sm whitespace-pre-wrap ${
                        message.role === 'user' ? 'text-white' : 'text-gray-700'
                      }`}
                    >
                      {message.content}
                    </div>
                  )}
                </div>

                {/* Sources */}
                {message.sources && message.sources.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {message.sources.map((source, idx) => (
                      <span
                        key={idx}
                        className="text-xs px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-600 border border-cyan-100"
                      >
                        {source.type}: {source.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Timestamp */}
                <p
                  className={`text-xs text-gray-400 mt-1 ${
                    message.role === 'user' ? 'text-right' : ''
                  }`}
                >
                  {message.timestamp.toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Actions */}
        <div className="px-4 py-2 border-t border-gray-100 bg-white">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {quickActions.map((action, idx) => (
              <button
                key={idx}
                onClick={() => handleQuickAction(action.prompt)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 hover:bg-cyan-50 hover:text-cyan-600 text-gray-600 text-xs whitespace-nowrap transition-colors"
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
        </div>

        {/* Input */}
        <div className="p-4 border-t border-gray-100 bg-white">
          <div className="flex gap-2">
            <TextArea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="输入您的问题..."
              autoSize={{ minRows: 1, maxRows: 4 }}
              className="flex-1 resize-none rounded-xl"
              disabled={isLoading}
            />
            <Button
              type="primary"
              icon={isLoading ? <LoadingOutlined /> : <SendOutlined />}
              onClick={handleSend}
              disabled={!inputValue.trim() || isLoading}
              className="bg-cyan-500 hover:bg-cyan-600 rounded-xl h-auto px-4"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

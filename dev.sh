#!/bin/bash
# ============================================================
# 流域水环境AI智能监测与预警平台 - 本地调试一键启动脚本
#
# 部署形态：本地后端（单体） + Docker 基础设施依赖
#
# 使用方式:
#   bash dev.sh           # 启动基础设施 + 单体后端 + 前端
#   bash dev.sh infra     # 只启动基础设施
#   bash dev.sh backend   # 只启动基础设施 + 后端（不启前端）
#   bash dev.sh stop      # 停止所有
# ============================================================

set -e
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

# 颜色
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
GRAY='\033[0;90m'
NC='\033[0m'

echo ""
echo -e "${CYAN}==========================================${NC}"
echo -e "${CYAN}  Water-ENV 本地调试启动器${NC}"
echo -e "${CYAN}==========================================${NC}"
echo ""

# ==================== 停止模式 ====================
if [ "${1}" = "stop" ]; then
    echo -e "${YELLOW}[STOP] 停止所有服务...${NC}"

    # 按端口杀后端进程（单体 8000）
    for port in 8000 5173; do
        pid=$(lsof -ti :$port 2>/dev/null || true)
        if [ -n "$pid" ]; then
            kill -9 $pid 2>/dev/null || true
            echo -e "  ${GREEN}已停止端口 $port 上的进程${NC}"
        fi
    done

    # 停止基础设施容器
    echo -e "  ${YELLOW}停止 Docker 基础设施...${NC}"
    docker-compose -f "$PROJECT_ROOT/docker-compose.yml" down 2>/dev/null || true
    echo ""
    echo -e "  ${GREEN}[OK] 全部已停止${NC}"
    echo ""
    exit 0
fi

# ==================== 环境变量（本地调试用） ====================
export DATABASE_URL="postgresql+asyncpg://water:water123@localhost:5432/water_env"
export TDENGINE_HOST="localhost"
export TDENGINE_PORT="6041"
export TDENGINE_USER="root"
export TDENGINE_PASSWORD="taosdata"
export NEO4J_URI="bolt://localhost:7687"
export NEO4J_USER="neo4j"
export NEO4J_PASSWORD="water123"
export MQTT_BROKER_HOST="localhost"
export MQTT_BROKER_PORT="1883"
export MINIO_ENDPOINT="localhost:9000"
export MINIO_ACCESS_KEY="water"
export MINIO_SECRET_KEY="water12345"
export REPORT_OUTPUT_PATH="$PROJECT_ROOT/backend/reports"
export REPORT_TEMPLATE_PATH="$PROJECT_ROOT/backend/app/report/templates"

# ==================== 1. 启动基础设施 ====================
echo -e "${BLUE}[STEP 1] 启动基础设施 (Docker)...${NC}"

docker-compose -f "$PROJECT_ROOT/docker-compose.yml" up -d
if [ $? -ne 0 ]; then
    echo -e "  ${RED}[FAIL] Docker 基础设施启动失败!${NC}"
    exit 1
fi

echo -e "  ${YELLOW}等待基础设施就绪...${NC}"
sleep 8

# 检查 PostgreSQL
retries=0
while [ $retries -lt 15 ]; do
    if docker exec water_postgres pg_isready -U water -d water_env >/dev/null 2>&1; then
        break
    fi
    retries=$((retries + 1))
    sleep 2
done
if [ $retries -ge 15 ]; then
    echo -e "  ${YELLOW}[WARN] PostgreSQL 可能未就绪，继续启动...${NC}"
else
    echo -e "  ${GREEN}[OK] PostgreSQL 就绪${NC}"
fi

echo -e "  ${GREEN}[OK] 基础设施已启动${NC}"
echo ""

if [ "${1}" = "infra" ]; then
    echo -e "  ${CYAN}基础设施端口:${NC}"
    echo "    PostgreSQL : localhost:5432"
    echo "    TDengine   : localhost:6041 (REST) / 6030 (taosc)"
    echo "    Neo4j      : localhost:7687 (Bolt) / 7474 (Web)"
    echo "    EMQX       : localhost:1883 (MQTT) / 18083 (Dashboard)"
    echo "    MinIO      : localhost:9000 (API) / 9001 (Console)"
    echo ""
    exit 0
fi

# ==================== 2. 启动后端（单体） ====================
echo -e "${BLUE}[STEP 2] 启动后端 (单体 FastAPI)...${NC}"

mkdir -p "$PROJECT_ROOT/backend/logs"

if lsof -ti :8000 >/dev/null 2>&1; then
    echo -e "  ${YELLOW}[SKIP] 后端端口 8000 已被占用${NC}"
else
    cd "$PROJECT_ROOT/backend"
    nohup python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload \
        > "$PROJECT_ROOT/backend/logs/backend.log" 2>&1 &
    echo -e "  ${GREEN}[OK] backend -> http://localhost:8000/docs${NC}"
fi

echo ""

if [ "${1}" = "backend" ]; then
    echo -e "  ${CYAN}后端: http://localhost:8000/docs${NC}"
    echo ""
    exit 0
fi

# ==================== 3. 启动前端 ====================
echo -e "${BLUE}[STEP 3] 启动前端 (Vite dev)...${NC}"

if lsof -ti :5173 >/dev/null 2>&1; then
    echo -e "  ${YELLOW}[SKIP] 前端端口 5173 已被占用${NC}"
else
    cd "$PROJECT_ROOT/frontend"
    nohup npm run dev > "$PROJECT_ROOT/backend/logs/frontend.log" 2>&1 &
    echo -e "  ${GREEN}[OK] 前端 -> http://localhost:5173${NC}"
fi

echo ""

# ==================== 汇总 ====================
echo -e "${CYAN}==========================================${NC}"
echo -e "${GREEN}  全部启动完成!${NC}"
echo -e "${CYAN}==========================================${NC}"
echo ""
echo -e "  前端:        http://localhost:5173"
echo -e "  后端 API:    http://localhost:8000/docs"
echo ""
echo -e "  ${CYAN}基础设施:${NC}"
echo "    PostgreSQL : localhost:5432"
echo "    TDengine   : localhost:6041"
echo "    Neo4j Web  : http://localhost:7474"
echo "    EMQX Dash  : http://localhost:18083"
echo "    MinIO      : http://localhost:9001"
echo ""
echo -e "  ${GRAY}日志文件在 backend/logs/*.log${NC}"
echo -e "  ${GRAY}停止所有: bash dev.sh stop${NC}"
echo ""

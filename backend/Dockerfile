FROM python:3.11-slim

WORKDIR /app

# 安装系统依赖（weasyprint 需要额外的系统库）
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libffi-dev \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖（torch 使用 CPU 版本）
COPY requirements.txt .
RUN pip install --no-cache-dir torch==2.1.0+cpu --extra-index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

# 复制 shared 模块
COPY shared/ ./shared/

# 复制单体应用代码
COPY app/ ./app/

# 创建必要目录
RUN mkdir -p /app/models /app/reports /app/templates

# 暴露端口
EXPOSE 8000

# 启动命令
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

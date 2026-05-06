"""
Water Environment AI Platform - Backend Startup Script
Usage: python run.py
环境变量 RELOAD=1 开启代码热重载（开发环境）
"""
import os
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=os.getenv("RELOAD", "1") == "1",
        reload_dirs=["app", "shared"],
    )

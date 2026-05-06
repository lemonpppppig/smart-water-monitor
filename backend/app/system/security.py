"""安全相关：密码哈希 + JWT"""
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings


# ==================== 密码哈希 ====================
# 部分环境（conda / py3.11+）下 passlib+bcrypt 可能因 bcrypt>=4 兼容性报错。
# 这里捕获初始化错误，降级到 pbkdf2_sha256，保证登录流程可用。
try:
    _pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    _pwd_context.hash("probe")  # 触发后端初始化
except Exception:  # pragma: no cover
    _pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash:
        return False
    try:
        return _pwd_context.verify(password, password_hash)
    except Exception:
        return False


# ==================== JWT ====================
JWT_ALGORITHM = "HS256"
JWT_SECRET = settings.JWT_SECRET
JWT_EXPIRE_SECONDS = 86400  # 1 day


def create_access_token(subject: str, extra: Optional[Dict[str, Any]] = None, expires_in: int = JWT_EXPIRE_SECONDS) -> str:
    now = datetime.utcnow()
    payload: Dict[str, Any] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        return None

"""
知识推理引擎
- 规则引擎：从Neo4j知识图谱加载污染规则
- 案例推理：从PostgreSQL+pgvector查询相似案例
- 污染类型识别
"""
import logging
from typing import List, Dict, Any
from datetime import datetime

from app.ai.config import settings

logger = logging.getLogger(__name__)


class KnowledgeEngine:
    """知识推理引擎
    
    数据来源：
    - 污染规则、应急预案：Neo4j知识图谱
    - 历史案例：PostgreSQL + pgvector
    """
    
    # 特征向量的指标顺序（与数据库中的向量对应）
    FEATURE_ORDER = [
        'nh3_n', 'do', 'codmn', 'ph', 'codcr', 'conductivity',
        'chlorophyll', 'blue_green_algae', 'total_n', 'total_p',
        'turbidity', 'transparency', 'orp', 'temperature', 'flow_rate', 'water_level'
    ]
    
    def __init__(self, neo4j_client, pg_pool):
        """初始化知识引擎
        
        Args:
            neo4j_client: Neo4j客户端（用于知识图谱查询）
            pg_pool: PostgreSQL连接池（用于案例库查询）
        """
        self.neo4j_client = neo4j_client
        self.pg_pool = pg_pool
        self._rules_cache: Dict[str, Dict] = {}  # 规则缓存
        self._cache_loaded = False
    
    async def _ensure_cache_loaded(self):
        """确保规则缓存已加载"""
        if self._cache_loaded:
            return
        
        await self._load_rules_from_neo4j()
        self._cache_loaded = True
    
    async def _load_rules_from_neo4j(self):
        """从Neo4j加载污染规则"""
        rules_data = await self.neo4j_client.get_pollution_rules()
        
        for item in rules_data:
            pollution_type = item['pollution_type']
            self._rules_cache[pollution_type] = {
                'name': item['pollution_name'],
                'description': item['description'],
                'judgment_basis': item.get('judgment_basis', ''),
                'features': {}
            }
            
            for rule in item['rules']:
                metric = rule['metric']
                self._rules_cache[pollution_type]['features'][metric] = {
                    'min': rule.get('min_value'),
                    'max': rule.get('max_value'),
                    'weight': rule.get('weight', 0.1)
                }
        
        logger.info(f"Loaded {len(self._rules_cache)} pollution rules from Neo4j")
    
    def _data_to_vector(self, data: Dict[str, float]) -> List[float]:
        """将数据转换为特征向量"""
        return [data.get(f, 0.0) for f in self.FEATURE_ORDER]
    
    async def identify_pollution_type(self, data: Dict[str, float]) -> Dict[str, Any]:
        """识别污染类型（基于规则引擎）"""
        await self._ensure_cache_loaded()
        
        scores = {}
        
        for pollution_type, rule in self._rules_cache.items():
            score = 0.0
            matched_features = 0
            
            for feature, condition in rule["features"].items():
                value = data.get(feature)
                if value is None:
                    continue
                
                weight = condition.get("weight", 0.1)
                min_val = condition.get("min")
                max_val = condition.get("max")
                
                # 检查是否满足条件
                if min_val is not None and max_val is not None:
                    if min_val <= value <= max_val:
                        score += weight
                        matched_features += 1
                elif min_val is not None:
                    if value >= min_val:
                        match_degree = min(1.0, (value - min_val) / min_val) if min_val > 0 else 1.0
                        score += weight * (0.5 + 0.5 * match_degree)
                        matched_features += 1
                elif max_val is not None:
                    if value <= max_val:
                        match_degree = min(1.0, (max_val - value) / abs(max_val)) if max_val != 0 else 1.0
                        score += weight * (0.5 + 0.5 * match_degree)
                        matched_features += 1
            
            scores[pollution_type] = {
                "score": score,
                "matched_features": matched_features,
                "total_features": len(rule["features"])
            }
        
        # 排序并返回最可能的类型
        # 注：不在此处卡硬阈值（旧逻辑 score > 0.3 导致大量 unknown），
        # 只要有任何非零得分就返回最高分的类型，confidence 直接反映得分。
        sorted_scores = sorted(scores.items(), key=lambda x: x[1]["score"], reverse=True)

        if sorted_scores and sorted_scores[0][1]["score"] > 0:
            best_match = sorted_scores[0]
            pollution_type = best_match[0]
            rule = self._rules_cache[pollution_type]

            return {
                "pollution_type": pollution_type,
                "pollution_name": rule["name"],
                "description": rule["description"],
                "confidence": round(best_match[1]["score"], 2),
                "matched_features": best_match[1]["matched_features"],
                "all_scores": {k: round(v["score"], 2) for k, v in sorted_scores[:3]}
            }

        return {
            "pollution_type": "unknown",
            "pollution_name": "未知类型",
            "description": "数据不足或未命中任何规则，无法识别污染类型",
            "confidence": 0.0,
            "matched_features": 0,
            "all_scores": {k: round(v["score"], 2) for k, v in sorted_scores[:3]}
        }
    
    async def case_based_reasoning(self, data: Dict[str, float], top_k: int = 3) -> List[Dict[str, Any]]:
        """基于案例的推理（从PostgreSQL查询相似案例）"""
        await self._ensure_cache_loaded()
        
        vector = self._data_to_vector(data)
        vector_str = '[' + ','.join(str(v) for v in vector) + ']'
        
        query = """
        SELECT 
            case_code,
            pollution_type,
            description,
            features,
            cause,
            source,
            actions_taken,
            outcome,
            recovery_days,
            1 - (feature_vector <=> $1::vector) as similarity
        FROM pollution_cases
        WHERE feature_vector IS NOT NULL
        ORDER BY feature_vector <=> $1::vector
        LIMIT $2
        """
        
        async with self.pg_pool.acquire() as conn:
            rows = await conn.fetch(query, vector_str, top_k)
        
        similar_cases = []
        for row in rows:
            if row['similarity'] > 0.5:  # 相似度阈值
                similar_cases.append({
                    "case_id": row['case_code'],
                    "pollution_type": row['pollution_type'],
                    "pollution_name": self._rules_cache.get(row['pollution_type'], {}).get("name", "未知"),
                    "similarity": round(float(row['similarity']), 3),
                    "description": row['description'],
                    "cause": row['cause'],
                    "source": row['source'],
                    "actions_taken": row['actions_taken'],
                    "outcome": row['outcome'],
                    "recovery_days": row['recovery_days']
                })
        
        return similar_cases
    
    async def get_emergency_plan(self, pollution_type: str) -> Dict[str, Any]:
        """获取应急处置预案"""
        await self._ensure_cache_loaded()
        
        plan = await self.neo4j_client.get_emergency_plan(pollution_type)
        
        if plan:
            return {
                "pollution_type": plan["pollution_type"],
                "pollution_name": plan["pollution_name"],
                "plan_name": plan.get("plan_name", ""),
                "actions": plan.get("actions", []),
                "departments": [d["name"] for d in plan.get("departments", []) if d.get("name")],
                "priority": plan.get("priority", "medium"),
                "response_time": plan.get("response_time", "")
            }
        
        # 未找到预案时返回默认结构
        return {
            "pollution_type": pollution_type,
            "pollution_name": self._rules_cache.get(pollution_type, {}).get("name", "未知"),
            "plan_name": "",
            "actions": [],
            "departments": [],
            "priority": "unknown",
            "response_time": ""
        }
    
    async def analyze(self, data: Dict[str, float]) -> Dict[str, Any]:
        """综合分析"""
        # 1. 规则引擎识别
        rule_result = await self.identify_pollution_type(data)
        
        # 2. 案例推理
        similar_cases = await self.case_based_reasoning(data)
        
        # 3. 获取处置建议
        emergency_plan = await self.get_emergency_plan(rule_result["pollution_type"])
        
        return {
            "rule_based": rule_result,
            "case_based": similar_cases,
            "emergency_plan": emergency_plan,
            "timestamp": datetime.now().isoformat()
        }
    
    # ==================== 核心方法：知识分析 ====================
    async def analyze_knowledge_core(self, data: Dict[str, float]) -> Dict[str, Any]:
        """知识分析核心：规则匹配 + 案例检索"""
        await self._ensure_cache_loaded()
        # 1. 规则匹配（从Neo4j缓存的规则）
        scores = {pt: sum(r.get("weight", 0.1) for m, r in rule["features"].items() if m in data)
                  for pt, rule in self._rules_cache.items()}
        best_type = max(scores, key=scores.get) if scores else "unknown"
        pollution = {"type": best_type, "name": self._rules_cache.get(best_type, {}).get("name", "未知"),
                     "score": round(scores.get(best_type, 0), 2)}
        # 2. 案例检索（用污染类型匹配，返回多条历史案例）
        cases = []
        async with self.pg_pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT case_code, pollution_type, description, cause, source, actions_taken, outcome, recovery_days "
                "FROM pollution_cases WHERE pollution_type = $1 ORDER BY occurrence_date DESC LIMIT 3", best_type)
            cases = [dict(r) for r in rows]
        # 3. 获取预案
        plan = await self.neo4j_client.get_emergency_plan(best_type)
        return {"pollution": pollution, "cases": cases, "plan": plan}

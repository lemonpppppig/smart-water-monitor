                                                                # ============================================================================
# pack-region.ps1 — 多区域独立交付包构建脚本
# ============================================================================
# 作用：
#   从当前主仓库（包含三城市数据的 "全量" 工程）派生出**仅含单一城市**的独立
#   交付副本，并完成以下自动化改写：
#     1) robocopy 复制工程到 <OutDir>\ai-water-env-<region>，自动排除
#        node_modules / .venv / __pycache__ / .git / dist / logs 等大目录
#     2) 删除其他两个 region 的目录（regions\<other>）
#     3) 改写 backend\.env：REGION_CODE 和 MODEL_PATH
#     4) 改写 frontend\.env.development / .env.production：VITE_REGION
#     5) 改写 frontend\tsconfig.app.json：@region/* paths
#     6) grep 扫描残留其他 region 关键字（只警告，不中断）
#     7) 可选：Compress-Archive 打成 zip
#
# 交付到客户侧后，客户只需：
#   cd ai-water-env-<region>
#   docker compose up -d              # PG/Neo4j/TDengine/Redis 基础设施
#   python deploy/init_all.py --up    # 一键初始化数据
#   cd backend  &  python -m uvicorn app.main:app --port 8000 --reload
#   cd frontend &  npm install ; npm run dev
#
# 用法：
#   # 打包合肥交付物（默认输出到 .\dist-region\，并生成 zip）
#   .\deploy\pack-region.ps1 -Region hefei
#
#   # 打包南昌，指定输出目录，不生成 zip
#   .\deploy\pack-region.ps1 -Region nanchang -OutDir D:\delivery -NoZip
#
#   # 覆盖已存在目录
#   .\deploy\pack-region.ps1 -Region ganzhou -Force
# ============================================================================

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('ganzhou', 'hefei', 'nanchang')]
    [string]$Region,

    [string]$OutDir = '',

    [switch]$NoZip,
    [switch]$Force,
    [switch]$IncludeImages
)

$ErrorActionPreference = 'Stop'

# 兼容 PS 5.1：param 默认值阶段 $PSScriptRoot 可能为空，延后解析
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrEmpty($OutDir)) {
    $OutDir = Join-Path $ScriptDir '..\dist-region'
}

# ----------------------------------------------------------------------------
# 端口偏移矩阵（同机并行三套容器必须）
#   赣州 = 默认端口；合肥 = +1/+10/+100；南昌 = +2/+20/+200
# ----------------------------------------------------------------------------
$RegionPortMatrix = @{
    'ganzhou' = @{
        COMPOSE_PROJECT_NAME  = 'water-ganzhou'
        CONTAINER_PREFIX      = 'water_gz'
        PG_PORT               = 5432
        TAOS_NATIVE_PORT      = 6030
        TAOS_REST_PORT        = 6041
        NEO4J_HTTP_PORT       = 7474
        NEO4J_BOLT_PORT       = 7687
        EMQX_MQTT_PORT        = 1883
        EMQX_WS_PORT          = 8083
        EMQX_DASHBOARD_PORT   = 18083
        MINIO_S3_PORT         = 9000
        MINIO_CONSOLE_PORT    = 9001
    }
    'hefei' = @{
        COMPOSE_PROJECT_NAME  = 'water-hefei'
        CONTAINER_PREFIX      = 'water_hf'
        PG_PORT               = 5433
        TAOS_NATIVE_PORT      = 6130
        TAOS_REST_PORT        = 6141
        NEO4J_HTTP_PORT       = 7484
        NEO4J_BOLT_PORT       = 7697
        EMQX_MQTT_PORT        = 1893
        EMQX_WS_PORT          = 8093
        EMQX_DASHBOARD_PORT   = 18093
        MINIO_S3_PORT         = 9010
        MINIO_CONSOLE_PORT    = 9011
    }
    'nanchang' = @{
        COMPOSE_PROJECT_NAME  = 'water-nanchang'
        CONTAINER_PREFIX      = 'water_nc'
        PG_PORT               = 5434
        TAOS_NATIVE_PORT      = 6230
        TAOS_REST_PORT        = 6241
        NEO4J_HTTP_PORT       = 7494
        NEO4J_BOLT_PORT       = 7707
        EMQX_MQTT_PORT        = 1903
        EMQX_WS_PORT          = 8103
        EMQX_DASHBOARD_PORT   = 18103
        MINIO_S3_PORT         = 9020
        MINIO_CONSOLE_PORT    = 9021
    }
}

# ----------------------------------------------------------------------------
# 0. 路径准备
# ----------------------------------------------------------------------------
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$OutDir   = (New-Item -ItemType Directory -Path $OutDir -Force).FullName
$PackName = "ai-water-env-$Region"
$PackDir  = Join-Path $OutDir $PackName

$AllRegions    = @('ganzhou', 'hefei', 'nanchang')
$OtherRegions  = $AllRegions | Where-Object { $_ -ne $Region }

Write-Host ""
Write-Host "=== pack-region.ps1 ===================================" -ForegroundColor Cyan
Write-Host "Region       : $Region"
Write-Host "RepoRoot     : $RepoRoot"
Write-Host "Output       : $PackDir"
Write-Host "Zip          : $(-not $NoZip)"
Write-Host "Images       : $IncludeImages"
Write-Host "=========================================================" -ForegroundColor Cyan

if (Test-Path $PackDir) {
    if ($Force) {
        Write-Host "[WARN] 目标已存在，-Force 启用，清空：$PackDir" -ForegroundColor Yellow
        Remove-Item -LiteralPath $PackDir -Recurse -Force
    } else {
        throw "目标目录已存在：$PackDir`n请加 -Force 覆盖，或换一个 -OutDir。"
    }
}

# ----------------------------------------------------------------------------
# 1. robocopy 复制工程（排除大目录）
# ----------------------------------------------------------------------------
Write-Host "`n[1/6] robocopy 工程 ... " -ForegroundColor Green

# robocopy 排除清单（目录名 & 文件模式）
$excludeDirs  = @(
    'node_modules', '.venv', '.vscode', '.idea',
    '__pycache__', '.pytest_cache',
    'dist', 'build', 'logs',
    '.git', '.qoder',
    'water-env-offline-pack',       # deploy/ 下的旧离线包产物，过大
    'dist-region', 'dist-region-test'  # 本脚本自己的输出目录，必须排除避免自我嵌套复制
)
$excludeFiles = @(
    '*.pyc', '*.pyo', '*.log',
    '*.zip', '*.tar', '*.tar.gz',
    '.DS_Store', 'Thumbs.db'
)

$rcArgs = @(
    "$RepoRoot",
    "$PackDir",
    '/E',           # 递归含空目录
    '/NFL', '/NDL', # 抑制文件/目录日志
    '/NP',          # 不显示进度
    '/R:1', '/W:1'  # 失败重试 1 次 / 间隔 1 秒
)
$rcArgs += '/XD'
$rcArgs += $excludeDirs
$rcArgs += '/XF'
$rcArgs += $excludeFiles

& robocopy @rcArgs | Out-Null
# robocopy 退出码 0-7 皆为成功；>=8 为错误
if ($LASTEXITCODE -ge 8) {
    throw "robocopy 失败，退出码 $LASTEXITCODE"
}
Write-Host "     ✓ 复制完成" -ForegroundColor Green

# ----------------------------------------------------------------------------
# 2. 删除其他 region 目录
# ----------------------------------------------------------------------------
Write-Host "`n[2/6] 删除其他 region 数据 ..." -ForegroundColor Green
foreach ($other in $OtherRegions) {
    $path = Join-Path $PackDir "regions\$other"
    if (Test-Path $path) {
        Remove-Item -LiteralPath $path -Recurse -Force
        Write-Host "     ✓ 已删除 regions\$other"
    }
}

# 同时删除 infrastructure/docker/postgres/init 里的历史赣州 init（改用 regions/ 挂载）
# —— 仅当该目录存在时处理，不强制
$legacyPgInit = Join-Path $PackDir 'infrastructure\docker\postgres\init'
if (Test-Path $legacyPgInit) {
    Write-Host "     (保留 infrastructure\docker\postgres\init 作为 offline 备份)"
}

# ----------------------------------------------------------------------------
# 3. 改写 backend\.env
# ----------------------------------------------------------------------------
Write-Host "`n[3/6] 改写 backend\.env ..." -ForegroundColor Green
$backendEnv = Join-Path $PackDir 'backend\.env'
if (-not (Test-Path $backendEnv)) {
    throw "未找到 backend\.env：$backendEnv"
}
$content = Get-Content -LiteralPath $backendEnv -Raw -Encoding UTF8
$content = [regex]::Replace($content, '(?m)^\s*REGION_CODE\s*=.*$',   "REGION_CODE=$Region")
# MODEL_PATH 改成 regions/<code>/ml_models 的绝对路径占位（由客户侧据实替换）
$content = [regex]::Replace(
    $content,
    '(?m)^\s*MODEL_PATH\s*=.*$',
    "MODEL_PATH=./regions/$Region/ml_models"
)
Set-Content -LiteralPath $backendEnv -Value $content -Encoding UTF8 -NoNewline
Write-Host "     ✓ REGION_CODE=$Region"
Write-Host "     ✓ MODEL_PATH=./regions/$Region/ml_models"

# ----------------------------------------------------------------------------
# 3.5 生成根 .env（docker-compose 自动读取）+ 同步 backend/.env 端口
# ----------------------------------------------------------------------------
Write-Host "`n[3.5/6] 注入端口偏移配置（同机并行必需）..." -ForegroundColor Green
$ports = $RegionPortMatrix[$Region]
if (-not $ports) { throw "未在 RegionPortMatrix 中找到 $Region 的端口配置" }

# 写根 .env（docker-compose 自动读取同目录 .env）
$rootEnv = Join-Path $PackDir '.env'
$envLines = @(
    "# 由 deploy/pack-region.ps1 自动生成，用于隔离同机多套容器",
    "# region = $Region",
    "REGION_CODE=$Region",
    "COMPOSE_PROJECT_NAME=$($ports.COMPOSE_PROJECT_NAME)",
    "CONTAINER_PREFIX=$($ports.CONTAINER_PREFIX)",
    "PG_PORT=$($ports.PG_PORT)",
    "TAOS_NATIVE_PORT=$($ports.TAOS_NATIVE_PORT)",
    "TAOS_REST_PORT=$($ports.TAOS_REST_PORT)",
    "NEO4J_HTTP_PORT=$($ports.NEO4J_HTTP_PORT)",
    "NEO4J_BOLT_PORT=$($ports.NEO4J_BOLT_PORT)",
    "EMQX_MQTT_PORT=$($ports.EMQX_MQTT_PORT)",
    "EMQX_WS_PORT=$($ports.EMQX_WS_PORT)",
    "EMQX_DASHBOARD_PORT=$($ports.EMQX_DASHBOARD_PORT)",
    "MINIO_S3_PORT=$($ports.MINIO_S3_PORT)",
    "MINIO_CONSOLE_PORT=$($ports.MINIO_CONSOLE_PORT)"
)
Set-Content -LiteralPath $rootEnv -Value ($envLines -join "`n") -Encoding UTF8
Write-Host "     ✓ 写入 .env：CONTAINER_PREFIX=$($ports.CONTAINER_PREFIX)，PG_PORT=$($ports.PG_PORT)"

# 同步 backend/.env 的 DB 连接端口（后端本地启动走 localhost:<偏移端口>）
$beContent = Get-Content -LiteralPath $backendEnv -Raw -Encoding UTF8
if (-not $beContent.EndsWith("`n")) { $beContent += "`n" }
# 移除旧的 DATABASE_URL / TDENGINE_PORT / NEO4J_URI / MQTT_BROKER_PORT（若曾追加过）
$beContent = [regex]::Replace($beContent, '(?m)^\s*DATABASE_URL\s*=.*\r?\n?',     '')
$beContent = [regex]::Replace($beContent, '(?m)^\s*TDENGINE_PORT\s*=.*\r?\n?',    '')
$beContent = [regex]::Replace($beContent, '(?m)^\s*TDENGINE_HTTP_URL\s*=.*\r?\n?','')
$beContent = [regex]::Replace($beContent, '(?m)^\s*NEO4J_URI\s*=.*\r?\n?',        '')
$beContent = [regex]::Replace($beContent, '(?m)^\s*MQTT_BROKER_PORT\s*=.*\r?\n?', '')
$beContent += "`n# ------- Docker 容器端口偏移（由 pack-region.ps1 注入）-------`n"
$beContent += "DATABASE_URL=postgresql+asyncpg://water:water123@localhost:$($ports.PG_PORT)/water_env`n"
$beContent += "TDENGINE_PORT=$($ports.TAOS_REST_PORT)`n"
$beContent += "TDENGINE_HTTP_URL=http://localhost:$($ports.TAOS_REST_PORT)`n"
$beContent += "NEO4J_URI=bolt://localhost:$($ports.NEO4J_BOLT_PORT)`n"
$beContent += "MQTT_BROKER_PORT=$($ports.EMQX_MQTT_PORT)`n"
Set-Content -LiteralPath $backendEnv -Value $beContent -Encoding UTF8 -NoNewline
Write-Host "     ✓ backend/.env 追加 DB 连接端口 (PG=$($ports.PG_PORT), Neo4j=$($ports.NEO4J_BOLT_PORT), TAOS=$($ports.TAOS_REST_PORT))"

# ----------------------------------------------------------------------------
# 4. 改写 frontend\.env.development 和 .env.production
# ----------------------------------------------------------------------------
Write-Host "`n[4/6] 改写 frontend\.env.* ..." -ForegroundColor Green
foreach ($envFile in @('frontend\.env.development', 'frontend\.env.production')) {
    $full = Join-Path $PackDir $envFile
    if (-not (Test-Path $full)) {
        Write-Host "     [SKIP] 未找到：$envFile" -ForegroundColor Yellow
        continue
    }
    $c = Get-Content -LiteralPath $full -Raw -Encoding UTF8
    if ($c -match '(?m)^\s*VITE_REGION\s*=') {
        $c = [regex]::Replace($c, '(?m)^\s*VITE_REGION\s*=.*$', "VITE_REGION=$Region")
    } else {
        # 若无此项，追加
        if (-not $c.EndsWith("`n")) { $c += "`n" }
        $c += "VITE_REGION=$Region`n"
    }
    Set-Content -LiteralPath $full -Value $c -Encoding UTF8 -NoNewline
    Write-Host "     ✓ $envFile → VITE_REGION=$Region"
}

# ----------------------------------------------------------------------------
# 5. 改写 frontend\tsconfig.app.json 里的 @region/* paths
# ----------------------------------------------------------------------------
Write-Host "`n[5/6] 改写 frontend\tsconfig.app.json ..." -ForegroundColor Green
$tsconfig = Join-Path $PackDir 'frontend\tsconfig.app.json'
if (Test-Path $tsconfig) {
    $c = Get-Content -LiteralPath $tsconfig -Raw -Encoding UTF8
    # 匹配 "@region/*": ["../regions/xxx/*"]  把 xxx 替换成目标 region
    $pattern = '("@region/\*"\s*:\s*\[\s*")\.\./regions/[a-zA-Z0-9_\-]+/\*("\s*\])'
    if ($c -match $pattern) {
        $c = [regex]::Replace($c, $pattern, ('${1}../regions/' + $Region + '/*${2}'))
        Set-Content -LiteralPath $tsconfig -Value $c -Encoding UTF8 -NoNewline
        Write-Host "     ✓ @region/* → ../regions/$Region/*"
    } else {
        Write-Host "     [WARN] 未识别到 @region/* paths 项，请手工确认" -ForegroundColor Yellow
    }
} else {
    Write-Host "     [SKIP] 未找到 tsconfig.app.json" -ForegroundColor Yellow
}

# ----------------------------------------------------------------------------
# 6. 离线镜像导入（可选）
# ----------------------------------------------------------------------------
if ($IncludeImages) {
    Write-Host "`n[6/7] 离线镜像导出 + 复制到交付包 ..." -ForegroundColor Green
    $srcImages = Join-Path $RepoRoot 'deploy\images'
    $dstImages = Join-Path $PackDir 'deploy\images'

    # 检查是否需要先导出镜像
    $needExport = $false
    if (-not (Test-Path $srcImages)) {
        $needExport = $true
    } else {
        $existingTars = Get-ChildItem -Path $srcImages -Filter '*.tar' -File -ErrorAction SilentlyContinue
        if ($existingTars.Count -lt 5) { $needExport = $true }
    }

    if ($needExport) {
        Write-Host "     deploy/images/ 镜像不完整，自动调用 pack_images.py 导出 ..." -ForegroundColor Yellow
        $packScript = Join-Path $RepoRoot 'deploy\pack_images.py'
        if (-not (Test-Path $packScript)) {
            throw "未找到镜像导出脚本：$packScript"
        }
        $rc = & python $packScript
        if ($LASTEXITCODE -ne 0) {
            throw "pack_images.py 执行失败（exit=$LASTEXITCODE）。请确保 Docker 已启动且网络可用。"
        }
    }

    # 复制 tar 到交付包
    $tars = Get-ChildItem -Path $srcImages -Filter '*.tar' -File
    if ($tars.Count -eq 0) {
        Write-Host "     [WARN] 导出后仍无 .tar 文件，请检查 pack_images.py 输出" -ForegroundColor Yellow
    } else {
        New-Item -ItemType Directory -Path $dstImages -Force | Out-Null
        $totalSize = 0
        foreach ($tar in $tars) {
            Copy-Item -LiteralPath $tar.FullName -Destination $dstImages -Force
            $totalSize += $tar.Length
            Write-Host "     ✓ $($tar.Name)  ($([math]::Round($tar.Length / 1MB, 1)) MB)"
        }
        Write-Host "     共 $($tars.Count) 个镜像，合计 $([math]::Round($totalSize / 1MB, 1)) MB" -ForegroundColor Green
    }
} else {
    Write-Host "`n[6/7] 跳过离线镜像（如需包含请加 -IncludeImages）" -ForegroundColor DarkGray
}

# ----------------------------------------------------------------------------
# 7. 残留扫描 + 打 zip
# ----------------------------------------------------------------------------
Write-Host "`n[7/7] 扫描其他 region 残留关键字 ..." -ForegroundColor Green
$hits = @()
foreach ($other in $OtherRegions) {
    # 仅在代码/配置文件中扫描，且跳过 regions\_common
    $searchRoots = @(
        Join-Path $PackDir 'backend',
        Join-Path $PackDir 'frontend\src',
        Join-Path $PackDir 'frontend\vite.config.ts',
        Join-Path $PackDir 'frontend\.env.development',
        Join-Path $PackDir 'frontend\.env.production',
        Join-Path $PackDir 'frontend\tsconfig.app.json',
        Join-Path $PackDir 'scripts',
        Join-Path $PackDir 'deploy',
        Join-Path $PackDir 'docker-compose.yml',
        Join-Path $PackDir 'dev.sh'
    ) | Where-Object { Test-Path $_ }

    foreach ($root in $searchRoots) {
        try {
            $found = Select-String -Path $root -Pattern $other -SimpleMatch `
                -Include *.py, *.ts, *.tsx, *.js, *.json, *.yml, *.yaml, *.env*, *.ps1, *.sh, *.md `
                -Exclude *.min.js, package-lock.json `
                -Recurse -ErrorAction SilentlyContinue
            if ($found) {
                $hits += $found
            }
        } catch {
            # 忽略个别文件权限问题
        }
    }
}

if ($hits.Count -gt 0) {
    Write-Host "     [WARN] 发现 $($hits.Count) 处其他 region 残留（仅警告，不影响交付）" -ForegroundColor Yellow
    $hits | Select-Object -First 20 | ForEach-Object {
        $rel = $_.Path.Replace($PackDir, '').TrimStart('\', '/')
        Write-Host "       ${rel}:$($_.LineNumber)  $($_.Line.Trim())" -ForegroundColor DarkYellow
    }
    if ($hits.Count -gt 20) {
        Write-Host "       ...（另 $($hits.Count - 20) 处省略）" -ForegroundColor DarkYellow
    }
    Write-Host "     建议：这些命中多数在 deploy 脚本/README 的注释里，若非代码逻辑可忽略。" -ForegroundColor DarkYellow
} else {
    Write-Host "     ✓ 无其他 region 关键字残留" -ForegroundColor Green
}

# ----------------------------------------------------------------------------
# 7. 打 zip
# ----------------------------------------------------------------------------
if (-not $NoZip) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $zipPath = Join-Path $OutDir "$PackName-$stamp.zip"
    Write-Host "`n[ZIP] 压缩中 ... $zipPath" -ForegroundColor Green
    # 注意：大型目录 Compress-Archive 较慢；如需 7z 请自行替换
    Compress-Archive -Path (Join-Path $PackDir '*') -DestinationPath $zipPath -Force
    $size = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
    Write-Host "     ✓ ZIP 完成，$size MB" -ForegroundColor Green
    Write-Host ""
    Write-Host "交付物：$zipPath" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "交付目录：$PackDir" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "=== DONE ===============================================" -ForegroundColor Cyan
Write-Host "客户侧首次部署（直接起新容器，无需清卷）：" -ForegroundColor White
Write-Host "  cd $PackName"
if ($IncludeImages) {
    Write-Host "  python deploy/init_all.py --up --load-images   # 离线镜像导入 + 启动 + 初始化" -ForegroundColor White
} else {
    Write-Host "  docker compose up -d postgres neo4j tdengine"
    Write-Host "    # 命名卷 $($ports.COMPOSE_PROJECT_NAME)_water_postgres_data 首次创建为空，"
    Write-Host "    # PG 会自动执行 regions/$Region/db/postgres/*.sql"
    Write-Host "  python deploy/init_all.py --up    # 触发 Neo4j / TDengine 种子"
}
Write-Host ""
Write-Host "该交付物宿主机暴露端口（可与其他 region 并行，互不冲突）：" -ForegroundColor Cyan
Write-Host ("  Postgres     localhost:{0}" -f $ports.PG_PORT)
Write-Host ("  Neo4j HTTP   http://localhost:{0}" -f $ports.NEO4J_HTTP_PORT)
Write-Host ("  Neo4j Bolt   bolt://localhost:{0}" -f $ports.NEO4J_BOLT_PORT)
Write-Host ("  TDengine     http://localhost:{0}" -f $ports.TAOS_REST_PORT)
Write-Host ("  EMQX Dash    http://localhost:{0}" -f $ports.EMQX_DASHBOARD_PORT)
Write-Host ("  MinIO        http://localhost:{0}  (Console {1})" -f $ports.MINIO_S3_PORT, $ports.MINIO_CONSOLE_PORT)
Write-Host ""
Write-Host "若要在已部署过的机器上重建数据，先清卷：" -ForegroundColor DarkYellow
Write-Host "  docker compose down -v" -ForegroundColor DarkYellow
Write-Host "=========================================================" -ForegroundColor Cyan

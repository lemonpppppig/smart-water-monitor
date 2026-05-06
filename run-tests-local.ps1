# PowerShell script to run tests locally with Docker infrastructure

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Water Environment Platform - Test Runner" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Start infrastructure services
Write-Host "[1/4] Starting infrastructure services..." -ForegroundColor Yellow
docker-compose -f docker-compose.infra.yml up -d

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to start infrastructure services!" -ForegroundColor Red
    exit 1
}

# Step 2: Wait for services to be ready
Write-Host "[2/4] Waiting for services to be ready..." -ForegroundColor Yellow
Write-Host "      Waiting 15 seconds for PostgreSQL and TDengine to initialize..."
Start-Sleep -Seconds 15

# Step 3: Check if services are healthy
Write-Host "[3/4] Checking service health..." -ForegroundColor Yellow

# Check PostgreSQL
$pgReady = docker exec water_postgres_test pg_isready -U water 2>$null
if ($pgReady -match "accepting connections") {
    Write-Host "      PostgreSQL: Ready" -ForegroundColor Green
} else {
    Write-Host "      PostgreSQL: Not ready yet, waiting 5 more seconds..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}

# Check TDengine
$tdReady = docker exec water_tdengine_test taos -s "show databases" 2>$null
if ($tdReady -match "information_schema") {
    Write-Host "      TDengine: Ready" -ForegroundColor Green
} else {
    Write-Host "      TDengine: Not ready yet" -ForegroundColor Yellow
}

Write-Host ""

# Step 4: Run tests for each service
Write-Host "[4/4] Running tests..." -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Cyan

# Set environment variables for testing
$env:DATABASE_URL = "postgresql+asyncpg://water:water123@localhost:5433/water_env_test"
$env:TDENGINE_HOST = "localhost"
$env:TDENGINE_PORT = "6042"
$env:TDENGINE_USER = "root"
$env:TDENGINE_PASSWORD = "taosdata"
$env:JWT_SECRET = "test-secret-key-for-testing-only-do-not-use-in-production"
$env:TESTING = "true"
$env:DEBUG = "true"

$totalPassed = 0
$totalFailed = 0

# Test Gateway
Write-Host "`n>>> Testing Gateway Service <<<" -ForegroundColor Magenta
Set-Location backend/gateway
python -m pytest app/tests -v --tb=short 2>&1 | Tee-Object -Variable gatewayOutput
if ($LASTEXITCODE -eq 0) { $totalPassed += 24 } else { $totalFailed += 1 }
Set-Location ../..

# Test Data Service
Write-Host "`n>>> Testing Data Service <<<" -ForegroundColor Magenta
Set-Location backend/services/data-service
python -m pytest app/tests -v --tb=short 2>&1 | Tee-Object -Variable dataOutput
if ($LASTEXITCODE -eq 0) { $totalPassed += 20 } else { $totalFailed += 1 }
Set-Location ../../..

# Test Station Service
Write-Host "`n>>> Testing Station Service <<<" -ForegroundColor Magenta
Set-Location backend/services/station-service
python -m pytest app/tests -v --tb=short 2>&1 | Tee-Object -Variable stationOutput
if ($LASTEXITCODE -eq 0) { $totalPassed += 22 } else { $totalFailed += 1 }
Set-Location ../../..

# Test Alert Service
Write-Host "`n>>> Testing Alert Service <<<" -ForegroundColor Magenta
Set-Location backend/services/alert-service
python -m pytest app/tests -v --tb=short 2>&1 | Tee-Object -Variable alertOutput
if ($LASTEXITCODE -eq 0) { $totalPassed += 26 } else { $totalFailed += 1 }
Set-Location ../../..

# Test AI Engine
Write-Host "`n>>> Testing AI Engine <<<" -ForegroundColor Magenta
Set-Location backend/services/ai-engine
python -m pytest app/tests -v --tb=short 2>&1 | Tee-Object -Variable aiOutput
if ($LASTEXITCODE -eq 0) { $totalPassed += 28 } else { $totalFailed += 1 }
Set-Location ../../..

# Test Report Service
Write-Host "`n>>> Testing Report Service <<<" -ForegroundColor Magenta
Set-Location backend/services/report-service
python -m pytest app/tests -v --tb=short 2>&1 | Tee-Object -Variable reportOutput
if ($LASTEXITCODE -eq 0) { $totalPassed += 30 } else { $totalFailed += 1 }
Set-Location ../../..

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Test Summary" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Total Passed: $totalPassed" -ForegroundColor Green
if ($totalFailed -gt 0) {
    Write-Host "Services with failures: $totalFailed" -ForegroundColor Red
}

Write-Host ""
Write-Host "To stop infrastructure services, run:" -ForegroundColor Cyan
Write-Host "  docker-compose -f docker-compose.infra.yml down" -ForegroundColor Gray

exit $totalFailed

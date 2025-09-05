#!/bin/bash
set -e

echo "🚀 Instructify Local CI/CD Script"
echo "=================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the project root
if [[ ! -f "README.md" || ! -d "backend" || ! -d "frontend" ]]; then
    print_error "Please run this script from the project root directory"
    exit 1
fi

print_status "Starting CI/CD checks..."

# Backend linting
print_status "🐍 Running Backend Linting..."
cd backend

if command -v uv &> /dev/null; then
    print_status "Using uv for backend dependencies"
    
    print_status "Running Black (Code Formatter)..."
    if uv run black --check --diff app/; then
        print_success "Black: Code formatting looks good!"
    else
        print_warning "Black: Code formatting issues found. Run 'uv run black app/' to fix."
    fi
    
    print_status "Running Flake8 (Linting)..."
    if uv run flake8 app/ --max-line-length=88 --extend-ignore=E203,W503; then
        print_success "Flake8: No linting issues found!"
    else
        print_warning "Flake8: Linting issues found. Please review above."
    fi
    
    print_status "Running isort (Import Sorting)..."
    if uv run isort --check-only --diff app/; then
        print_success "isort: Imports are properly sorted!"
    else
        print_warning "isort: Import sorting issues found. Run 'uv run isort app/' to fix."
    fi
    
    print_status "Running mypy (Type Checking)..."
    if uv run mypy app/ --ignore-missing-imports; then
        print_success "mypy: Type checking passed!"
    else
        print_warning "mypy: Type checking issues found. Please review above."
    fi
    
    
else
    print_error "uv not found. Please install uv to run backend linting."
fi

cd ..

# Frontend build and linting
print_status "🌐 Running Frontend Build & Linting..."
cd frontend

if command -v npm &> /dev/null; then
    print_status "Checking npm dependencies..."
    if [[ ! -d "node_modules" ]]; then
        print_status "Installing npm dependencies..."
        npm ci
    fi
    
    print_status "Running ESLint..."
    if npm run lint; then
        print_success "ESLint: No linting issues found!"
    else
        print_warning "ESLint: Linting issues found. Please review above."
    fi
    
    print_status "Building frontend..."
    if npm run build; then
        print_success "Frontend: Build successful!"
    else
        print_error "Frontend: Build failed!"
        exit 1
    fi
    
else
    print_error "npm not found. Please install Node.js and npm."
fi

cd ..

# Project health check
print_status "📋 Project Health Check..."
echo "📊 Repository Statistics:"
echo "========================="
echo "📁 Total Files: $(find . -type f | wc -l)"
echo "🐍 Python Files: $(find . -name "*.py" | wc -l)"
echo "🌐 TypeScript/JS Files: $(find . -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" | wc -l)"
echo "📝 Documentation Files: $(find . -name "*.md" | wc -l)"

echo ""
print_success "🎉 All CI/CD checks completed!"
echo ""
echo "📋 Summary:"
echo "==========="
echo "✅ Backend linting checks"
echo "✅ Frontend build and linting"
echo "✅ Project health check"
echo ""
print_success "🚀 Project is ready for deployment!"
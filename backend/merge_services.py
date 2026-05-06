"""
Merge microservices into monolith structure.
Copies service files to backend/app/{service}/ and rewrites imports.
"""
import os
import re
import shutil

BASE_DIR = r"d:\code\racing_project\ai-water-env\backend"
TARGET_DIR = os.path.join(BASE_DIR, "app")

# Service mapping: (source_dir, target_subdir, import_prefix)
SERVICES = [
    ("services/station-service/app", "station", "app.station"),
    ("services/data-service/app", "data", "app.data"),
    ("services/alert-service/app", "alert", "app.alert"),
    ("services/ai-engine/app", "ai", "app.ai"),
    ("services/report-service/app", "report", "app.report"),
]

def rewrite_imports(content, service_name):
    """Rewrite from app.xxx to from app.{service}.xxx"""
    # Match: from app.xxx import ... or import app.xxx
    # But NOT: from app.station.xxx (already rewritten)
    
    # Pattern: from app. followed by something that's NOT one of our service names
    service_names = ["station", "data", "alert", "ai", "report"]
    
    # Rewrite "from app." imports
    def replace_from(match):
        prefix = match.group(1)  # "from app."
        rest = match.group(2)    # module path after "app."
        # Don't rewrite if it already starts with a service name
        for sn in service_names:
            if rest.startswith(sn + ".") or rest == sn:
                return match.group(0)
        return f"from app.{service_name}.{rest}"
    
    content = re.sub(r'(from app\.)([\w.]+)', replace_from, content)
    
    # Rewrite "import app." imports  
    def replace_import(match):
        rest = match.group(1)
        for sn in service_names:
            if rest.startswith(sn + ".") or rest == sn:
                return match.group(0)
        return f"import app.{service_name}.{rest}"
    
    content = re.sub(r'import app\.([\w.]+)', replace_import, content)
    
    return content


def process_service(src_rel, target_subdir, import_prefix):
    src_dir = os.path.join(BASE_DIR, src_rel)
    dst_dir = os.path.join(TARGET_DIR, target_subdir)
    
    if not os.path.exists(src_dir):
        print(f"  SKIP: {src_dir} does not exist")
        return
    
    for root, dirs, files in os.walk(src_dir):
        # Skip __pycache__
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        
        for filename in files:
            if not filename.endswith(".py"):
                continue
            
            src_path = os.path.join(root, filename)
            rel_path = os.path.relpath(src_path, src_dir)
            dst_path = os.path.join(dst_dir, rel_path)
            
            # Create target directory
            os.makedirs(os.path.dirname(dst_path), exist_ok=True)
            
            # Read, rewrite, write
            with open(src_path, "r", encoding="utf-8") as f:
                content = f.read()
            
            new_content = rewrite_imports(content, target_subdir)
            
            # Special handling for ai-engine __init__.py - remove sys.path hack
            if target_subdir == "ai" and filename == "__init__.py" and "sys.path" in content:
                new_content = "# AI Engine Module\n"
            
            with open(dst_path, "w", encoding="utf-8") as f:
                f.write(new_content)
            
            changed = " (imports rewritten)" if content != new_content else ""
            print(f"  {rel_path}{changed}")


def create_init_files():
    """Create __init__.py for api/ subdirectories"""
    for service in ["station", "data", "alert", "ai", "report"]:
        api_init = os.path.join(TARGET_DIR, service, "api", "__init__.py")
        if not os.path.exists(api_init):
            os.makedirs(os.path.dirname(api_init), exist_ok=True)
            with open(api_init, "w") as f:
                f.write(f"# {service} API\n")


def main():
    # Create target root
    os.makedirs(TARGET_DIR, exist_ok=True)
    
    # Create root __init__.py if not exists
    root_init = os.path.join(TARGET_DIR, "__init__.py")
    if not os.path.exists(root_init):
        with open(root_init, "w") as f:
            f.write("# Water Environment Monolith Application\n")
    
    for src_rel, target_subdir, import_prefix in SERVICES:
        print(f"\nProcessing {target_subdir}:")
        process_service(src_rel, target_subdir, import_prefix)
    
    create_init_files()
    print("\nDone! All services copied to backend/app/")


if __name__ == "__main__":
    main()

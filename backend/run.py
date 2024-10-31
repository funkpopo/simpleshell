import os
import sys
import subprocess

def install_requirements():
    try:
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-r', 'requirements.txt'])
        print("Dependencies installed successfully")
    except subprocess.CalledProcessError as e:
        print(f"Failed to install dependencies: {e}")
        sys.exit(1)

def run_server():
    try:
        subprocess.check_call([sys.executable, 'service.py'])
    except subprocess.CalledProcessError as e:
        print(f"Failed to start server: {e}")
        sys.exit(1)

if __name__ == '__main__':
    # 确保我们在正确的目录中
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    print("Checking dependencies...")
    install_requirements()
    
    print("Starting server...")
    run_server() 
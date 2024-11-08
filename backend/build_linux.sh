#!/bin/bash

# 安装依赖
pip install -r requirements.txt

# 确保有执行权限
chmod +x build_linux.py
chmod +x runtime_hook.py

# 运行打包脚本
python3 build_linux.py 
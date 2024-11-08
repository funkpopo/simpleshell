import PyInstaller.__main__
import os
import shutil

# 清理之前的构建
if os.path.exists('dist'):
    shutil.rmtree('dist')
if os.path.exists('build'):
    shutil.rmtree('build')

# 设置打包参数
PyInstaller.__main__.run([
    'service.py',
    '--onefile',
    '--clean',
    # 添加所需的动态库
    '--add-binary=/usr/lib/x86_64-linux-gnu/libcrypto.so.3:.',
    '--add-binary=/usr/lib/x86_64-linux-gnu/libssl.so.3:.',
    # 设置运行时搜索路径
    '--runtime-hook=runtime_hook.py'
]) 
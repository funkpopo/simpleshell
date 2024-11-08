import os
import sys

# 将可执行文件所在目录添加到库搜索路径
if getattr(sys, 'frozen', False):
    bundle_dir = sys._MEIPASS
    os.environ['LD_LIBRARY_PATH'] = bundle_dir + os.pathsep + os.environ.get('LD_LIBRARY_PATH', '') 
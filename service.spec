# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = ['gevent.monkey', 'gevent.builtins', 'gevent.signal', 'gevent.libev.corecext', 'gevent.libuv.loop', 'gevent.socket', 'gevent.threading', 'gevent._threading', 'gevent.time', 'gevent.os', 'gevent.select', 'gevent.ssl', 'gevent.subprocess', 'gevent.thread', 'gevent.resolver.thread', 'gevent.resolver.blocking', 'gevent.resolver.cares', 'gevent.resolver.dnspython', 'gevent._ssl3', 'engineio.async_drivers.gevent', 'openai', 'ollama', 'zhipuai', 'numpy', 'pandas', 'aiohttp', 'urllib3', 'ssl']
tmp_ret = collect_all('gevent')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('aiohttp')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('urllib3')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


a = Analysis(
    ['service.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='service',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='service',
)

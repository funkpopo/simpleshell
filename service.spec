# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = ['gevent.builtins', 'gevent.signal', 'gevent.libev.corecext', 'gevent.libuv.loop', 'gevent.socket', 'gevent.threading', 'gevent._threading', 'gevent.time', 'gevent.os', 'gevent.select', 'gevent.ssl', 'gevent.subprocess', 'gevent.thread', 'gevent.resolver.thread', 'gevent.resolver.blocking', 'gevent.resolver.cares', 'gevent.resolver.dnspython', 'gevent._ssl3', 'engineio.async_drivers.gevent', 'openai', 'ollama', 'zhipuai', 'numpy', 'pandas']
tmp_ret = collect_all('gevent')
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
    a.binaries,
    a.datas,
    [],
    name='service',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

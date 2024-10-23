from PyInstaller.utils.hooks import collect_submodules, collect_data_files

# Collect all eventlet submodules
hiddenimports = collect_submodules('eventlet')

# Add specific hub implementations
hiddenimports.extend([
    'eventlet.hubs.epolls',
    'eventlet.hubs.kqueue',
    'eventlet.hubs.selects',
    'eventlet.hubs.poll',
    'eventlet.hubs.hub',
    'eventlet.hubs.timer',
    'eventlet.green',
    'eventlet.greenpool',
    'eventlet.queue',
    'eventlet.timeout',
    'eventlet.websocket',
    'eventlet.wsgi',
    'eventlet.support',
    'eventlet.support.greendns',
    'eventlet.support.psycopg2_patcher',
    'eventlet.support.six',
    'eventlet.support.wrap_threading',
    'dns',
    'dns.rdtypes',
    'dns.rdtypes.IN',
    'dns.rdtypes.ANY',
    'dns.rdtypes.CH'
])

# Collect data files
datas = collect_data_files('eventlet')

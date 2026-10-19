# Configuration ownership

`configService.js` is the public facade and the single owner of the config path,
validated disk snapshots, serialization and write ordering. Existing callers
continue to use its load/save commands.

Domain services under `domains/` own their transformations and commands:

| Domain                | Responsibility                                                            |
| --------------------- | ------------------------------------------------------------------------- |
| `configBackups`       | Backup naming, retention and cleanup                                      |
| `connectionSettings`  | Connection tree traversal, credential preservation and recent connections |
| `aiSettings`          | Provider settings and secret encryption/decryption                        |
| `applicationSettings` | UI/log settings, shortcuts and command history                            |
| `configMaintenance`   | Clearing local data and stripping sensitive fields                        |
| `credentialSecurity`  | Security migration, locking, unlocking and credential re-encryption       |

Each receives explicit commands/state fields through `serviceDependencies` and
only the external dependencies it uses. Config caches and crypto state keep one
owner; domain services do not keep a second copy. Named command adapters read the
current owner, while function-valued state keeps its identity for listener cleanup.
Loading, validation and saving remain synchronous transactions at the facade.

Local coverage includes `tests/unit/aiServices.test.js`,
`terminalState.test.js`, `serviceDependencies.test.js`, and the native SFTP and SSH
integration suites. Use `npm run check` and `npm run test:integration`.

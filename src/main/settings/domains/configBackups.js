/** ConfigBackups: explicit dependencies supplied by the service facade. */
function createConfigBackups(
  dependencies,
  {
    getConfigBackupDirectory,
    buildFileTimestamp,
    fs,
    path,
    MAX_CONFIG_BACKUPS,
  },
) {
  return new (class ConfigBackups {
    constructor() {
      this.dependencies = dependencies;
    }
    _getConfigBackupDirectory() {
      return getConfigBackupDirectory(this.dependencies.app);
    }
    _formatTimestampForFile(date = new Date()) {
      return buildFileTimestamp(date);
    }
    _safeJsonStringify(config) {
      return JSON.stringify(config, null, 2);
    }
    _ensureDirectory(dirPath) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    _createConfigBackup(reason = "manual") {
      if (
        !this.dependencies.mainConfigPath ||
        !fs.existsSync(this.dependencies.mainConfigPath)
      ) {
        return null;
      }

      const backupDir = this._getConfigBackupDirectory();
      this._ensureDirectory(backupDir);
      const normalizedReason = String(reason || "manual")
        .replace(/[^a-zA-Z0-9_-]/g, "-")
        .slice(0, 40);
      const backupPath = path.join(
        backupDir,
        `config.${this._formatTimestampForFile()}.${normalizedReason}.json`,
      );
      fs.copyFileSync(this.dependencies.mainConfigPath, backupPath);
      this._cleanupOldConfigBackups();
      this.dependencies._log(
        `ConfigService: Backup created at ${backupPath}`,
        "INFO",
      );
      return backupPath;
    }
    _cleanupOldConfigBackups() {
      const backupDir = this._getConfigBackupDirectory();
      if (!fs.existsSync(backupDir)) {
        return;
      }

      let backupRetentionDays = 30;
      try {
        const config = this.dependencies._readConfig();
        backupRetentionDays = config?.uiSettings?.backupRetentionDays ?? 30;
      } catch {
        // use default
      }

      const now = Date.now();
      const retentionMs = backupRetentionDays * 24 * 60 * 60 * 1000;

      const backupFiles = fs
        .readdirSync(backupDir, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isFile() &&
            /^config\..+\.[a-zA-Z0-9_-]+\.json$/.test(entry.name),
        )
        .map((entry) => ({
          name: entry.name,
          path: path.join(backupDir, entry.name),
          mtimeMs: fs.statSync(path.join(backupDir, entry.name)).mtimeMs,
        }))
        .sort((left, right) => right.mtimeMs - left.mtimeMs);

      const toDelete = [];
      for (const entry of backupFiles) {
        if (now - entry.mtimeMs > retentionMs) {
          toDelete.push(entry);
        }
      }

      // also enforce count limit as a safety net
      const remaining = backupFiles.filter((e) => !toDelete.includes(e));
      if (remaining.length > MAX_CONFIG_BACKUPS) {
        remaining.slice(MAX_CONFIG_BACKUPS).forEach((entry) => {
          toDelete.push(entry);
        });
      }

      toDelete.forEach((entry) => {
        try {
          fs.unlinkSync(entry.path);
        } catch (error) {
          this.dependencies._log(
            `ConfigService: Failed to remove old backup ${entry.name} - ${error.message}`,
            "WARN",
          );
        }
      });
    }
  })();
}
module.exports = createConfigBackups;

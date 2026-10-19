import Dialog from "../../../shared/ui/AccessibleDialog.jsx";
import {
  Box,
  Typography,
  IconButton,
  TextField,
  Button,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Tooltip,
  Switch,
  Checkbox,
  FormControlLabel,
  Divider,
  Alert,
  CircularProgress,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import ErrorOutlinedIcon from "@mui/icons-material/ErrorOutlined";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { useTranslation } from "react-i18next";
import {
  SERIAL_BAUD_RATES,
  squareIconButtonSx,
} from "../lib/connectionForm.js";

export default function ConnectionEditorDialog({ editor }) {
  const { t } = useTranslation();
  const {
    dialogOpen,
    handleDialogClose,
    dialogMode,
    dialogType,
    formData,
    handleFormChange,
    handleRefreshSerialPorts,
    serialPortsLoading,
    serialPorts,
    setFormData,
    showPassword,
    handleTogglePasswordVisibility,
    revealingPassword,
    groups,
    validationSteps,
    connectionTestResult,
    autoSaveEnabled,
    handleTestConnection,
    canTestConnection,
    testingConnection,
    handleSave,
  } = editor;
  const groupOptions = groups.map((group) => (
    <MenuItem key={group.id} value={group.id}>
      {group.name}
    </MenuItem>
  ));
  const renderValidationStep = (step) => {
    const isChecking = step.severity === "checking";
    const isWarning = step.severity === "warning";
    const color = step.ok
      ? isWarning
        ? "warning.main"
        : "success.main"
      : isChecking
        ? "text.secondary"
        : "error.main";

    return (
      <Box
        key={step.key}
        sx={{
          display: "flex",
          alignItems: "flex-start",
          gap: 1,
          py: 0.5,
        }}
      >
        <Box sx={{ color, mt: 0.1, lineHeight: 0 }}>
          {isChecking ? (
            <CircularProgress size={16} />
          ) : step.ok ? (
            <CheckCircleOutlinedIcon fontSize="small" />
          ) : (
            <ErrorOutlinedIcon fontSize="small" />
          )}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {step.title}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", lineHeight: 1.35 }}
          >
            {step.message}
          </Typography>
        </Box>
      </Box>
    );
  };
  return (
    <Dialog
      open={dialogOpen}
      onClose={handleDialogClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            maxHeight: "90vh",
          },
        },
      }}
    >
      <DialogTitle>
        {dialogMode === "add"
          ? dialogType === "connection"
            ? t("connectionManager.newConnection")
            : t("connectionManager.newGroup")
          : dialogType === "connection"
            ? t("connectionManager.editConnection")
            : t("connectionManager.editGroup")}
      </DialogTitle>
      <DialogContent
        dividers
        sx={{
          overflow: "auto",
          maxHeight: "calc(90vh - 120px)",
        }}
      >
        <Box
          component="form"
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 1.5,
            py: 1,
          }}
        >
          <TextField
            label={t("common.name")}
            name="name"
            value={formData.name}
            onChange={handleFormChange}
            fullWidth
            size="small"
            required
          />

          {dialogType === "connection" && (
            <>
              <FormControl fullWidth size="small">
                <InputLabel>{t("connectionManager.protocol")}</InputLabel>
                <Select
                  name="protocol"
                  value={formData.protocol || "ssh"}
                  label={t("connectionManager.protocol")}
                  onChange={handleFormChange}
                >
                  <MenuItem value="ssh">SSH</MenuItem>
                  <MenuItem value="telnet">Telnet</MenuItem>
                  <MenuItem value="serial">
                    {t("connectionManager.serialProtocol")}
                  </MenuItem>
                  <MenuItem value="mosh">
                    {t("connectionManager.moshProtocol")}
                  </MenuItem>
                </Select>
              </FormControl>

              {formData.protocol === "serial" ? (
                <>
                  <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                    <TextField
                      label={t("connectionManager.serialPortPath")}
                      name="host"
                      value={formData.host}
                      onChange={handleFormChange}
                      fullWidth
                      size="small"
                      required
                      placeholder="COM3"
                      helperText={t("connectionManager.serialPortPathHint")}
                      sx={{ flexGrow: 1, minWidth: 0 }}
                    />
                    <Tooltip title={t("connectionManager.detectPorts")}>
                      <span>
                        <IconButton
                          aria-label={t("connectionManager.detectPorts")}
                          size="small"
                          onClick={handleRefreshSerialPorts}
                          disabled={serialPortsLoading}
                          sx={squareIconButtonSx}
                        >
                          {serialPortsLoading ? (
                            <CircularProgress size={18} />
                          ) : (
                            <RefreshIcon fontSize="small" />
                          )}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>

                  {serialPorts.length > 0 && (
                    <FormControl fullWidth size="small">
                      <InputLabel>
                        {t("connectionManager.detectedPorts")}
                      </InputLabel>
                      <Select
                        name="detectedSerialPort"
                        value=""
                        label={t("connectionManager.detectedPorts")}
                        onChange={(e) => {
                          if (e.target.value) {
                            setFormData((prev) => ({
                              ...prev,
                              host: e.target.value,
                            }));
                          }
                        }}
                      >
                        {serialPorts.map((port) => (
                          <MenuItem key={port.path} value={port.path}>
                            {port.friendlyName &&
                            port.friendlyName !== port.path
                              ? `${port.path} - ${port.friendlyName}`
                              : port.path}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}

                  <Box sx={{ display: "flex", gap: 1 }}>
                    <FormControl size="small" sx={{ flex: 2, minWidth: 0 }}>
                      <InputLabel>{t("connectionManager.baudRate")}</InputLabel>
                      <Select
                        name="baudRate"
                        value={formData.baudRate}
                        label={t("connectionManager.baudRate")}
                        onChange={handleFormChange}
                      >
                        {SERIAL_BAUD_RATES.map((rate) => (
                          <MenuItem key={rate} value={rate}>
                            {rate}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
                      <InputLabel>{t("connectionManager.dataBits")}</InputLabel>
                      <Select
                        name="dataBits"
                        value={formData.dataBits}
                        label={t("connectionManager.dataBits")}
                        onChange={handleFormChange}
                      >
                        <MenuItem value={7}>7</MenuItem>
                        <MenuItem value={8}>8</MenuItem>
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
                      <InputLabel>{t("connectionManager.stopBits")}</InputLabel>
                      <Select
                        name="stopBits"
                        value={formData.stopBits}
                        label={t("connectionManager.stopBits")}
                        onChange={handleFormChange}
                      >
                        <MenuItem value={1}>1</MenuItem>
                        <MenuItem value={2}>2</MenuItem>
                      </Select>
                    </FormControl>
                  </Box>

                  <Box sx={{ display: "flex", gap: 1 }}>
                    <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
                      <InputLabel>{t("connectionManager.parity")}</InputLabel>
                      <Select
                        name="parity"
                        value={formData.parity}
                        label={t("connectionManager.parity")}
                        onChange={handleFormChange}
                      >
                        <MenuItem value="none">
                          {t("connectionManager.parityNone")}
                        </MenuItem>
                        <MenuItem value="even">
                          {t("connectionManager.parityEven")}
                        </MenuItem>
                        <MenuItem value="odd">
                          {t("connectionManager.parityOdd")}
                        </MenuItem>
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
                      <InputLabel>
                        {t("connectionManager.flowControl")}
                      </InputLabel>
                      <Select
                        name="flowControl"
                        value={formData.flowControl}
                        label={t("connectionManager.flowControl")}
                        onChange={handleFormChange}
                      >
                        <MenuItem value="none">
                          {t("connectionManager.flowControlNone")}
                        </MenuItem>
                        <MenuItem value="rtscts">
                          {t("connectionManager.flowControlRtsCts")}
                        </MenuItem>
                        <MenuItem value="xonxoff">
                          {t("connectionManager.flowControlXonXoff")}
                        </MenuItem>
                      </Select>
                    </FormControl>
                  </Box>
                </>
              ) : formData.protocol === "mosh" ? (
                <>
                  <TextField
                    label={t("connectionManager.hostAddress")}
                    name="host"
                    value={formData.host}
                    onChange={handleFormChange}
                    fullWidth
                    size="small"
                    required
                  />

                  <TextField
                    label={t("connectionManager.port")}
                    name="port"
                    type="number"
                    value={formData.port}
                    onChange={handleFormChange}
                    fullWidth
                    size="small"
                    placeholder="22"
                    helperText={t("connectionManager.moshSshPortHint")}
                  />

                  <TextField
                    label={t("connectionManager.username")}
                    name="username"
                    value={formData.username}
                    onChange={handleFormChange}
                    fullWidth
                    size="small"
                    helperText={t("connectionManager.moshUsernameHint")}
                  />

                  <TextField
                    label={t("connectionManager.moshBinaryPath")}
                    name="moshBinaryPath"
                    value={formData.moshBinaryPath}
                    onChange={handleFormChange}
                    fullWidth
                    size="small"
                    placeholder="mosh"
                    helperText={t("connectionManager.moshBinaryPathHint")}
                  />

                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={formData.moshUseWsl === true}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            moshUseWsl: e.target.checked,
                          }))
                        }
                        size="small"
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="body2">
                          {t("connectionManager.moshUseWsl")}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t("connectionManager.moshUseWslHint")}
                        </Typography>
                      </Box>
                    }
                  />

                  <Box sx={{ display: "flex", gap: 1 }}>
                    <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
                      <InputLabel>
                        {t("connectionManager.moshPredict")}
                      </InputLabel>
                      <Select
                        name="moshPredict"
                        value={formData.moshPredict}
                        label={t("connectionManager.moshPredict")}
                        onChange={handleFormChange}
                      >
                        <MenuItem value="adaptive">
                          {t("connectionManager.moshPredictAdaptive")}
                        </MenuItem>
                        <MenuItem value="always">
                          {t("connectionManager.moshPredictAlways")}
                        </MenuItem>
                        <MenuItem value="never">
                          {t("connectionManager.moshPredictNever")}
                        </MenuItem>
                        <MenuItem value="experimental">
                          {t("connectionManager.moshPredictExperimental")}
                        </MenuItem>
                      </Select>
                    </FormControl>
                    <TextField
                      label={t("connectionManager.moshServerPort")}
                      name="moshServerPort"
                      value={formData.moshServerPort}
                      onChange={handleFormChange}
                      size="small"
                      sx={{ flex: 1, minWidth: 0 }}
                      placeholder="60000"
                      helperText={t("connectionManager.moshServerPortHint")}
                    />
                  </Box>
                </>
              ) : (
                <>
                  <TextField
                    label={t("connectionManager.hostAddress")}
                    name="host"
                    value={formData.host}
                    onChange={handleFormChange}
                    fullWidth
                    size="small"
                    required
                  />

                  <TextField
                    label={t("connectionManager.port")}
                    name="port"
                    type="number"
                    value={formData.port}
                    onChange={handleFormChange}
                    fullWidth
                    size="small"
                    placeholder={formData.protocol === "telnet" ? "23" : "22"}
                  />

                  <TextField
                    label={t("connectionManager.username")}
                    name="username"
                    value={formData.username}
                    onChange={handleFormChange}
                    fullWidth
                    size="small"
                  />

                  <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                    <TextField
                      label={t("connectionManager.password")}
                      name="password"
                      type={showPassword ? "text" : "password"}
                      value={formData.password}
                      onChange={handleFormChange}
                      fullWidth
                      size="small"
                      disabled={
                        formData.protocol === "ssh" &&
                        formData.authType === "privateKey"
                      }
                      sx={{ flex: 1, minWidth: 0 }}
                    />
                    <Tooltip
                      title={
                        showPassword
                          ? t("common.hidePassword")
                          : t("common.showPassword")
                      }
                    >
                      <span>
                        <IconButton
                          aria-label={
                            showPassword
                              ? t("common.hidePassword")
                              : t("common.showPassword")
                          }
                          size="small"
                          onClick={handleTogglePasswordVisibility}
                          disabled={
                            revealingPassword ||
                            (formData.protocol === "ssh" &&
                              formData.authType === "privateKey")
                          }
                          sx={squareIconButtonSx}
                        >
                          {revealingPassword ? (
                            <CircularProgress size={18} />
                          ) : showPassword ? (
                            <VisibilityOffIcon fontSize="small" />
                          ) : (
                            <VisibilityIcon fontSize="small" />
                          )}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>

                  {formData.protocol === "ssh" && (
                    <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                      <InputLabel>{t("connectionManager.authType")}</InputLabel>
                      <Select
                        name="authType"
                        value={formData.authType || "password"}
                        label={t("connectionManager.authType")}
                        onChange={handleFormChange}
                      >
                        <MenuItem value="password">
                          {t("connectionManager.passwordAuth")}
                        </MenuItem>
                        <MenuItem value="privateKey">
                          {t("connectionManager.privateKeyAuth")}
                        </MenuItem>
                        <MenuItem value="agent">
                          {t("connectionManager.agentAuth")}
                        </MenuItem>
                      </Select>
                    </FormControl>
                  )}

                  {formData.protocol === "ssh" &&
                    formData.authType === "privateKey" && (
                      <Box sx={{ display: "flex", mt: 1 }}>
                        <TextField
                          label={t("connectionManager.privateKeyPath")}
                          name="privateKeyPath"
                          value={formData.privateKeyPath}
                          onChange={handleFormChange}
                          fullWidth
                          size="small"
                          sx={{ flexGrow: 1 }}
                        />
                        <Button
                          variant="outlined"
                          size="small"
                          sx={{ ml: 1 }}
                          onClick={() => {
                            if (
                              window.terminalAPI &&
                              window.terminalAPI.selectKeyFile
                            ) {
                              window.terminalAPI
                                .selectKeyFile()
                                .then((result) => {
                                  if (result && result.success && result.path) {
                                    setFormData((prev) => ({
                                      ...prev,
                                      privateKeyPath: result.path,
                                    }));
                                  }
                                });
                            }
                          }}
                        >
                          {t("connectionManager.browse")}
                        </Button>
                      </Box>
                    )}

                  {formData.protocol === "ssh" && (
                    <Box sx={{ mt: 1 }}>
                      {(formData.authType === "agent" ||
                        formData.agentForward === true) && (
                        <TextField
                          label={t("connectionManager.agentPath")}
                          name="agentPath"
                          value={formData.agentPath || ""}
                          onChange={handleFormChange}
                          fullWidth
                          size="small"
                          placeholder={t(
                            "connectionManager.agentPathPlaceholder",
                          )}
                          helperText={t("connectionManager.agentPathHint")}
                        />
                      )}
                      <FormControlLabel
                        sx={{ mt: 1 }}
                        control={
                          <Checkbox
                            checked={formData.agentForward === true}
                            onChange={(e) =>
                              setFormData((prev) => ({
                                ...prev,
                                agentForward: e.target.checked,
                              }))
                            }
                            size="small"
                          />
                        }
                        label={
                          <Typography variant="body2">
                            {t("connectionManager.agentForward")}
                          </Typography>
                        }
                      />
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block" }}
                      >
                        {t("connectionManager.agentForwardHint")}
                      </Typography>
                    </Box>
                  )}
                </>
              )}

              <FormControl fullWidth size="small">
                <InputLabel>{t("connectionManager.group")}</InputLabel>
                <Select
                  name="parentGroup"
                  value={formData.parentGroup || ""}
                  label={t("connectionManager.group")}
                  onChange={handleFormChange}
                >
                  <MenuItem value="">
                    <em>{t("connectionManager.noGroup")}</em>
                  </MenuItem>
                  {groupOptions}
                </Select>
              </FormControl>

              <FormControl fullWidth size="small">
                <InputLabel>{t("connectionManager.type")}</InputLabel>
                <Select
                  name="connectionType"
                  value={formData.connectionType || ""}
                  label={t("connectionManager.type")}
                  onChange={handleFormChange}
                >
                  <MenuItem value="">
                    <em>{t("common.none")}</em>
                  </MenuItem>
                  <MenuItem value="VPS">VPS</MenuItem>
                  <MenuItem value="NAS">NAS</MenuItem>
                  <MenuItem value="BareMetal">
                    {t("connectionManager.bareMetal")}
                  </MenuItem>
                  <MenuItem value="Other">{t("common.other")}</MenuItem>
                </Select>
              </FormControl>

              <FormControl fullWidth size="small">
                <InputLabel>{t("connectionManager.os")}</InputLabel>
                <Select
                  name="os"
                  value={formData.os || ""}
                  label={t("connectionManager.os")}
                  onChange={handleFormChange}
                >
                  <MenuItem value="">
                    <em>{t("common.none")}</em>
                  </MenuItem>
                  <MenuItem value="Linux">Linux</MenuItem>
                  <MenuItem value="Windows">Windows</MenuItem>
                  <MenuItem value="macOS">macOS</MenuItem>
                  <MenuItem value="Other">{t("common.other")}</MenuItem>
                </Select>
              </FormControl>

              {/* 代理配置分割线 */}
              <Divider sx={{ my: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {t("connectionManager.proxyConfig")}
                </Typography>
              </Divider>

              {/* 启用代理开关 */}
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.enableProxy}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        enableProxy: e.target.checked,
                      }))
                    }
                    size="small"
                  />
                }
                label={t("connectionManager.enableProxy")}
              />

              {/* 代理配置表单 */}
              {formData.enableProxy && (
                <>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={formData.proxyUseDefault}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            proxyUseDefault: e.target.checked,
                          }))
                        }
                        size="small"
                      />
                    }
                    label={t("connectionManager.useSystemProxy")}
                  />

                  {!formData.proxyUseDefault && (
                    <Box
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 1.5,
                        pl: 2,
                        borderLeft: 2,
                        borderColor: "divider",
                      }}
                    >
                      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                        <FormControl
                          size="small"
                          sx={{ minWidth: 100, flexShrink: 0 }}
                        >
                          <InputLabel>{t("connectionManager.type")}</InputLabel>
                          <Select
                            name="proxyType"
                            value={formData.proxyType}
                            label={t("connectionManager.type")}
                            onChange={handleFormChange}
                          >
                            <MenuItem value="http">HTTP</MenuItem>
                            <MenuItem value="https">HTTPS</MenuItem>
                            <MenuItem value="socks4">SOCKS4</MenuItem>
                            <MenuItem value="socks5">SOCKS5</MenuItem>
                          </Select>
                        </FormControl>
                        <TextField
                          label={t("connectionManager.proxyHost")}
                          name="proxyHost"
                          value={formData.proxyHost}
                          onChange={handleFormChange}
                          size="small"
                          sx={{ flexGrow: 1 }}
                          placeholder="127.0.0.1"
                        />
                        <TextField
                          label={t("connectionManager.proxyPort")}
                          name="proxyPort"
                          type="number"
                          value={formData.proxyPort}
                          onChange={handleFormChange}
                          size="small"
                          sx={{ width: 90 }}
                          placeholder="8080"
                        />
                      </Box>

                      <Box sx={{ display: "flex", gap: 1 }}>
                        <TextField
                          label={t("connectionManager.proxyUsername")}
                          name="proxyUsername"
                          value={formData.proxyUsername}
                          onChange={handleFormChange}
                          size="small"
                          sx={{ flexGrow: 1 }}
                        />
                        <TextField
                          label={t("connectionManager.proxyPassword")}
                          name="proxyPassword"
                          type="password"
                          value={formData.proxyPassword}
                          onChange={handleFormChange}
                          size="small"
                          sx={{ flexGrow: 1 }}
                        />
                      </Box>
                    </Box>
                  )}
                </>
              )}

              {formData.protocol === "ssh" && (
                <Box
                  sx={{
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    p: 1.25,
                    bgcolor: "background.default",
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 700,
                      display: "block",
                      mb: 0.5,
                    }}
                  >
                    {t("connectionManager.validation.title")}
                  </Typography>
                  <Box>{validationSteps.map(renderValidationStep)}</Box>

                  {connectionTestResult ? (
                    <Alert
                      severity={
                        connectionTestResult.success ? "success" : "warning"
                      }
                      variant="outlined"
                      sx={{ mt: 1 }}
                    >
                      <Typography variant="body2">
                        {connectionTestResult.message}
                      </Typography>
                      {connectionTestResult.detail ? (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block", mt: 0.25 }}
                        >
                          {connectionTestResult.detail}
                        </Typography>
                      ) : null}
                    </Alert>
                  ) : null}
                </Box>
              )}
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        {autoSaveEnabled && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mr: "auto", pl: 2 }}
          >
            {t("connectionManager.autoSaveHint")}
          </Typography>
        )}
        {dialogType === "connection" && formData.protocol === "ssh" && (
          <Button
            onClick={handleTestConnection}
            disabled={!canTestConnection}
            startIcon={
              testingConnection ? <CircularProgress size={16} /> : null
            }
          >
            {testingConnection
              ? t("connectionManager.testing")
              : t("connectionManager.testConnection")}
          </Button>
        )}
        <Button onClick={handleDialogClose}>
          {autoSaveEnabled ? t("common.close") : t("common.cancel")}
        </Button>
        <Button onClick={handleSave} variant="contained">
          {t("common.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

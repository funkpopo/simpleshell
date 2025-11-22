import React, { useState, useCallback, memo } from "react";
import {
  Box,
  Paper,
  Typography,
  Slider,
  FormGroup,
  FormControlLabel,
  Checkbox,
  Button,
  TextField,
  IconButton,
  Tooltip,
  Tabs,
  Tab,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Divider,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { useTheme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RefreshIcon from "@mui/icons-material/Refresh";
import CheckIcon from "@mui/icons-material/Check";
import SaveIcon from "@mui/icons-material/Save";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import KeyIcon from "@mui/icons-material/Key";
import { SIDEBAR_WIDTHS } from "../constants/layout.js";

const RandomPasswordGenerator = ({ open, onClose }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  // 标签页状态
  const [tabValue, setTabValue] = useState(0);

  // 密码生成器状态
  const [length, setLength] = useState(8);
  const [options, setOptions] = useState({
    uppercase: true,
    lowercase: true,
    numbers: false,
    symbols: false,
  });
  const [password, setPassword] = useState("");
  const [copySuccess, setCopySuccess] = useState({
    password: false,
    publicKey: false,
    privateKey: false,
  });

  // SSH密钥生成器状态
  const [keyType, setKeyType] = useState("ed25519");
  const [keySize, setKeySize] = useState(256);
  const [comment, setComment] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [keyPair, setKeyPair] = useState({ publicKey: "", privateKey: "" });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const handleOptionChange = (event) => {
    setOptions({ ...options, [event.target.name]: event.target.checked });
  };

  const handleKeyTypeChange = (event) => {
    const newKeyType = event.target.value;
    setKeyType(newKeyType);

    // 根据密钥类型设置默认长度
    if (newKeyType === "ed25519") {
      setKeySize(256);
    } else if (newKeyType === "rsa") {
      setKeySize(2048);
    } else if (newKeyType === "ecdsa") {
      setKeySize(256);
    }
  };

  const getKeySizeOptions = () => {
    switch (keyType) {
      case "rsa":
        return [1024, 2048, 4096];
      case "ecdsa":
        return [256, 384, 521];
      case "ed25519":
        return [256]; // ED25519固定256位
      default:
        return [2048];
    }
  };

  const generateKeyPair = useCallback(async () => {
    setGenerating(true);
    setError("");

    try {
      // 通过IPC调用主进程生成SSH密钥对
      const result = await window.electronAPI.generateSSHKeyPair({
        type: keyType,
        bits: keySize,
        comment: comment || `${keyType}-key-${Date.now()}`,
        passphrase: passphrase,
      });

      if (result.success) {
        setKeyPair({
          publicKey: result.publicKey,
          privateKey: result.privateKey,
        });
      } else {
        setError(result.error || t("sshKeyGenerator.generateFailed"));
      }
    } catch (err) {
      setError(err.message || t("sshKeyGenerator.generateFailed"));
    } finally {
      setGenerating(false);
    }
  }, [keyType, keySize, comment, passphrase, t]);

  const generatePassword = useCallback(() => {
    const charSets = {
      uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      lowercase: "abcdefghijklmnopqrstuvwxyz",
      numbers: "0123456789",
      symbols: "!@#$%^&*()_+~`|}{[]:;?><,./-=",
    };

    let availableChars = "";
    if (options.uppercase) availableChars += charSets.uppercase;
    if (options.lowercase) availableChars += charSets.lowercase;
    if (options.numbers) availableChars += charSets.numbers;
    if (options.symbols) availableChars += charSets.symbols;

    if (!availableChars) {
      setPassword("");
      return;
    }

    let generatedPassword = "";
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * availableChars.length);
      generatedPassword += availableChars[randomIndex];
    }
    setPassword(generatedPassword);
  }, [length, options]);

  const copyToClipboard = (text, type) => {
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        setCopySuccess({ ...copySuccess, [type]: true });
        setTimeout(() => {
          setCopySuccess({ ...copySuccess, [type]: false });
        }, 2000);
      });
    }
  };

  const saveToFile = async (content, filename) => {
    try {
      await window.electronAPI.saveSSHKey({
        content,
        filename,
      });
    } catch (err) {
      setError(err.message || t("sshKeyGenerator.saveFailed"));
    }
  };

  React.useEffect(() => {
    if (open) {
      if (tabValue === 0) {
        generatePassword();
      } else if (tabValue === 1 && !keyPair.publicKey) {
        generateKeyPair();
      }
    }
  }, [open, tabValue, generatePassword, generateKeyPair]);

  return (
    <Paper
      elevation={4}
      sx={{
        width: open ? SIDEBAR_WIDTHS.SECURITY_TOOLS : 0,
        height: "100%",
        overflow: "hidden",
        transition: theme.transitions.create("width", {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.enteringScreen,
        }),
        borderLeft: `1px solid ${theme.palette.divider}`,
        display: "flex",
        flexDirection: "column",
        borderRadius: 0,
      }}
    >
      {open && (
        <>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              p: 2,
              borderBottom: `1px solid ${theme.palette.divider}`,
            }}
          >
            <Typography variant="subtitle1" fontWeight="medium">
              {t("securityTools.title")}
            </Typography>
            <IconButton size="small" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>

          {/* 标签页 */}
          <Box sx={{ borderBottom: `1px solid ${theme.palette.divider}` }}>
            <Tabs
              value={tabValue}
              onChange={(e, newValue) => setTabValue(newValue)}
              variant="fullWidth"
              sx={{
                minHeight: 40,
                "& .MuiTab-root": {
                  minHeight: 40,
                  fontSize: "0.85rem",
                },
              }}
            >
              <Tab
                icon={<VpnKeyIcon fontSize="small" />}
                iconPosition="start"
                label={t("securityTools.passwordTab")}
              />
              <Tab
                icon={<KeyIcon fontSize="small" />}
                iconPosition="start"
                label={t("securityTools.sshKeyTab")}
              />
            </Tabs>
          </Box>

          <Box
            sx={{
              flexGrow: 1,
              overflow: "hidden",
              overflowY: "auto",
              p: 1.5,
            }}
          >
            {/* 密码生成器标签页 */}
            {tabValue === 0 && (
              <>
                <Box sx={{ mb: 1.5, px: 1 }}>
                  <Typography gutterBottom sx={{ fontSize: "0.9rem" }}>
                    {t("randomPassword.length")}: {length}
                  </Typography>
                  <Slider
                    value={length}
                    onChange={(e, newValue) => setLength(newValue)}
                    aria-labelledby="password-length-slider"
                    valueLabelDisplay="auto"
                    step={1}
                    min={4}
                    max={32}
                    sx={{
                      width: "100%",
                      "& .MuiSlider-valueLabel": {
                        fontSize: "0.75rem",
                      },
                      "& .MuiSlider-thumb": {
                        "&:hover, &.Mui-focusVisible": {
                          boxShadow: "none",
                        },
                      },
                      "& .MuiSlider-track": {
                        border: "none",
                      },
                    }}
                  />
                </Box>

                <FormGroup sx={{ mb: 1.5 }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={options.uppercase}
                        onChange={handleOptionChange}
                        name="uppercase"
                        size="small"
                      />
                    }
                    label={
                      <Typography sx={{ fontSize: "0.85rem" }}>
                        {t("randomPassword.uppercase")}
                      </Typography>
                    }
                    sx={{ ml: 0 }}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={options.lowercase}
                        onChange={handleOptionChange}
                        name="lowercase"
                        size="small"
                      />
                    }
                    label={
                      <Typography sx={{ fontSize: "0.85rem" }}>
                        {t("randomPassword.lowercase")}
                      </Typography>
                    }
                    sx={{ ml: 0 }}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={options.numbers}
                        onChange={handleOptionChange}
                        name="numbers"
                        size="small"
                      />
                    }
                    label={
                      <Typography sx={{ fontSize: "0.85rem" }}>
                        {t("randomPassword.numbers")}
                      </Typography>
                    }
                    sx={{ ml: 0 }}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={options.symbols}
                        onChange={handleOptionChange}
                        name="symbols"
                        size="small"
                      />
                    }
                    label={
                      <Typography sx={{ fontSize: "0.85rem" }}>
                        {t("randomPassword.symbols")}
                      </Typography>
                    }
                    sx={{ ml: 0 }}
                  />
                </FormGroup>

                <Box sx={{ mb: 1.5 }}>
                  <TextField
                    value={password}
                    label={t("randomPassword.generatedPassword")}
                    variant="outlined"
                    fullWidth
                    size="small"
                    multiline
                    maxRows={6}
                    InputProps={{
                      readOnly: true,
                      sx: {
                        wordBreak: "break-all",
                      },
                    }}
                    sx={{ mb: 1 }}
                  />
                  <Box sx={{ display: "flex", gap: 1 }}>
                    <Tooltip
                      title={
                        copySuccess.password
                          ? t("randomPassword.copied")
                          : t("randomPassword.copy")
                      }
                      onClose={() =>
                        setCopySuccess({ ...copySuccess, password: false })
                      }
                    >
                      <IconButton
                        onClick={() => copyToClipboard(password, "password")}
                        size="small"
                        color="primary"
                      >
                        {copySuccess.password ? (
                          <CheckIcon color="success" />
                        ) : (
                          <ContentCopyIcon />
                        )}
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>

                <Button
                  variant="contained"
                  onClick={generatePassword}
                  startIcon={<RefreshIcon />}
                  size="small"
                  fullWidth
                >
                  {t("randomPassword.regenerate")}
                </Button>
              </>
            )}

            {/* SSH密钥生成器标签页 */}
            {tabValue === 1 && (
              <>
                {/* 密钥类型选择 */}
                <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                  <InputLabel>{t("sshKeyGenerator.keyType")}</InputLabel>
                  <Select
                    value={keyType}
                    label={t("sshKeyGenerator.keyType")}
                    onChange={handleKeyTypeChange}
                  >
                    <MenuItem value="ed25519">ED25519 (推荐)</MenuItem>
                    <MenuItem value="rsa">RSA</MenuItem>
                    <MenuItem value="ecdsa">ECDSA</MenuItem>
                  </Select>
                </FormControl>

                {/* 密钥长度选择 */}
                <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                  <InputLabel>{t("sshKeyGenerator.keySize")}</InputLabel>
                  <Select
                    value={keySize}
                    label={t("sshKeyGenerator.keySize")}
                    onChange={(e) => setKeySize(e.target.value)}
                    disabled={keyType === "ed25519"}
                  >
                    {getKeySizeOptions().map((size) => (
                      <MenuItem key={size} value={size}>
                        {size} bits
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                {/* 注释 */}
                <TextField
                  label={t("sshKeyGenerator.comment")}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  size="small"
                  fullWidth
                  sx={{ mb: 1 }}
                  placeholder={t("sshKeyGenerator.commentPlaceholder")}
                />

                {/* 密码短语 */}
                <TextField
                  label={t("sshKeyGenerator.passphrase")}
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  size="small"
                  fullWidth
                  sx={{ mb: 1 }}
                  placeholder={t("sshKeyGenerator.passphraseOptional")}
                />

                {/* 生成按钮 */}
                <Button
                  variant="contained"
                  onClick={generateKeyPair}
                  startIcon={<RefreshIcon />}
                  size="small"
                  fullWidth
                  disabled={generating}
                  sx={{ mb: 1.5 }}
                >
                  {generating
                    ? t("sshKeyGenerator.generating")
                    : t("sshKeyGenerator.generate")}
                </Button>

                {/* 错误信息 */}
                {error && (
                  <Alert severity="error" sx={{ mb: 1.5, py: 0.5 }}>
                    {error}
                  </Alert>
                )}

                {/* 公钥 */}
                {keyPair.publicKey && (
                  <>
                    <Divider sx={{ my: 1.5 }} />
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
                      <Typography
                        variant="subtitle2"
                        sx={{ fontWeight: "medium", fontSize: "0.85rem" }}
                      >
                        {t("sshKeyGenerator.publicKey")}
                      </Typography>
                      <Box sx={{ display: "flex", gap: 0.5 }}>
                        <Tooltip
                          title={
                            copySuccess.publicKey
                              ? t("sshKeyGenerator.copied")
                              : t("sshKeyGenerator.copy")
                          }
                        >
                          <IconButton
                            size="small"
                            onClick={() =>
                              copyToClipboard(keyPair.publicKey, "publicKey")
                            }
                          >
                            {copySuccess.publicKey ? (
                              <CheckIcon color="success" fontSize="small" />
                            ) : (
                              <ContentCopyIcon fontSize="small" />
                            )}
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t("sshKeyGenerator.savePublic")}>
                          <IconButton
                            size="small"
                            onClick={() =>
                              saveToFile(keyPair.publicKey, `id_${keyType}.pub`)
                            }
                          >
                            <SaveIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Box>
                    <TextField
                      value={keyPair.publicKey}
                      multiline
                      maxRows={3}
                      fullWidth
                      size="small"
                      InputProps={{
                        readOnly: true,
                      }}
                      sx={{ mb: 1.5 }}
                    />

                    {/* 私钥 */}
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
                      <Typography
                        variant="subtitle2"
                        sx={{ fontWeight: "medium", fontSize: "0.85rem" }}
                      >
                        {t("sshKeyGenerator.privateKey")}
                      </Typography>
                      <Box sx={{ display: "flex", gap: 0.5 }}>
                        <Tooltip
                          title={
                            copySuccess.privateKey
                              ? t("sshKeyGenerator.copied")
                              : t("sshKeyGenerator.copy")
                          }
                        >
                          <IconButton
                            size="small"
                            onClick={() =>
                              copyToClipboard(keyPair.privateKey, "privateKey")
                            }
                          >
                            {copySuccess.privateKey ? (
                              <CheckIcon color="success" fontSize="small" />
                            ) : (
                              <ContentCopyIcon fontSize="small" />
                            )}
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t("sshKeyGenerator.savePrivate")}>
                          <IconButton
                            size="small"
                            onClick={() =>
                              saveToFile(keyPair.privateKey, `id_${keyType}`)
                            }
                          >
                            <SaveIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Box>
                    <TextField
                      value={keyPair.privateKey}
                      multiline
                      maxRows={6}
                      fullWidth
                      size="small"
                      InputProps={{
                        readOnly: true,
                      }}
                      sx={{ mb: 1 }}
                    />

                    <Alert severity="warning" sx={{ fontSize: "0.75rem", py: 0.5 }}>
                      {t("sshKeyGenerator.securityWarning")}
                    </Alert>
                  </>
                )}
              </>
            )}
          </Box>
        </>
      )}
    </Paper>
  );
};

export default memo(RandomPasswordGenerator);

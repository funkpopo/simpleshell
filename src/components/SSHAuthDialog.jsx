import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Tabs,
  Tab,
  Checkbox,
  FormControlLabel,
  InputAdornment,
  IconButton,
  Chip,
} from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useTranslation } from "react-i18next";

/**
 * SSH 认证对话框组件
 * 用于连接校验、主机指纹验证、用户名密码认证
 */
const SSHAuthDialog = ({
  open,
  onClose,
  onConfirm,
  authData,
  connectionConfig,
}) => {
  const theme = useTheme();
  const { t } = useTranslation();
  
  // 对话框步骤: 'hostVerify' | 'credentials'
  const [step, setStep] = useState("hostVerify");
  
  // 凭证步骤的标签页: 0 = 密码, 1 = 公钥
  const [credTabValue, setCredTabValue] = useState(0);
  
  // 表单数据
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [autoLogin, setAutoLogin] = useState(false);
  
  // 输入框引用
  const usernameRef = useRef(null);
  const passwordRef = useRef(null);

  // 当对话框打开时重置状态
  useEffect(() => {
    if (open && authData) {
      setStep(authData.step || "hostVerify");
      setUsername(authData.username || connectionConfig?.username || "");
      setPassword("");
      setPrivateKeyPath(connectionConfig?.privateKeyPath || "");
      setAutoLogin(false);
      setShowPassword(false);
      
      // 根据连接配置设置认证类型
      if (connectionConfig?.authType === "privateKey") {
        setCredTabValue(1);
      } else {
        setCredTabValue(0);
      }
    }
  }, [open, authData, connectionConfig]);

  // 自动聚焦输入框
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        if (step === "hostVerify" && usernameRef.current) {
          usernameRef.current.focus();
        } else if (step === "credentials" && passwordRef.current) {
          passwordRef.current.focus();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [open, step]);

  // 处理主机验证步骤的继续
  const handleHostVerifyContinue = useCallback(() => {
    if (!username.trim()) {
      return;
    }
    
    // 如果是首次认证流程，进入凭证步骤
    if (authData?.requireCredentials !== false) {
      setStep("credentials");
    } else {
      // 只需要主机验证，直接确认
      onConfirm({
        username: username.trim(),
        autoLogin,
        acceptHostKey: true,
      });
    }
  }, [username, autoLogin, authData, onConfirm]);

  // 处理凭证步骤的继续
  const handleCredentialsContinue = useCallback(() => {
    const authType = credTabValue === 0 ? "password" : "privateKey";
    
    if (authType === "password" && !password) {
      return;
    }
    
    if (authType === "privateKey" && !privateKeyPath) {
      return;
    }
    
    onConfirm({
      username: username.trim(),
      password: authType === "password" ? password : undefined,
      privateKeyPath: authType === "privateKey" ? privateKeyPath : undefined,
      authType,
      autoLogin,
      acceptHostKey: true,
    });
  }, [username, password, privateKeyPath, credTabValue, autoLogin, onConfirm]);

  // 处理取消
  const handleCancel = useCallback(() => {
    onClose({ cancelled: true });
  }, [onClose]);

  // 处理键盘事件
  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (step === "hostVerify") {
        handleHostVerifyContinue();
      } else {
        handleCredentialsContinue();
      }
    } else if (e.key === "Escape") {
      handleCancel();
    }
  }, [step, handleHostVerifyContinue, handleCredentialsContinue, handleCancel]);

  // 选择私钥文件
  const handleSelectKeyFile = useCallback(async () => {
    if (window.terminalAPI && window.terminalAPI.selectKeyFile) {
      const result = await window.terminalAPI.selectKeyFile();
      if (result && result.success && result.path) {
        setPrivateKeyPath(result.path);
      }
    }
  }, []);

  // 渲染主机指纹信息
  const renderHostInfo = () => {
    if (!authData) return null;
    
    const { host, port, serverVersion, fingerprint, fingerprintChanged, isRetry, errorMessage } = authData;
    
    return (
      <Box sx={{ mb: 2 }}>
        {/* 认证失败提示 */}
        {isRetry && (
          <Box 
            sx={{ 
              mb: 2, 
              p: 1.5, 
              borderRadius: 1,
              bgcolor: alpha(theme.palette.error.main, 0.1),
              border: `1px solid ${alpha(theme.palette.error.main, 0.3)}`,
            }}
          >
            <Typography 
              variant="body2" 
              color="error"
              sx={{ fontWeight: 500, mb: 0.5 }}
            >
              {t("sshAuth.authFailed", "认证失败")}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {errorMessage || t("sshAuth.pleaseRetry", "请重新输入凭据")}
            </Typography>
          </Box>
        )}

        {/* 主机信息 */}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          {t("sshAuth.host", "主机")}:
        </Typography>
        <Typography variant="body2" sx={{ mb: 1.5, fontFamily: "monospace" }}>
          {host}:{port || 22} {serverVersion && `[${serverVersion}]`}
        </Typography>
        
        {/* SHA1 指纹 */}
        {fingerprint && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              SHA1:
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
              {fingerprintChanged && (
                <Chip
                  icon={<WarningAmberIcon />}
                  label={t("sshAuth.changed", "已更改")}
                  size="small"
                  color="warning"
                  sx={{ 
                    height: 22,
                    "& .MuiChip-label": { px: 1, fontSize: "0.75rem" }
                  }}
                />
              )}
              <Typography 
                variant="body2" 
                sx={{ 
                  fontFamily: "monospace",
                  fontSize: "0.8rem",
                  wordBreak: "break-all",
                  color: fingerprintChanged ? "warning.main" : "text.primary"
                }}
              >
                [{fingerprint}]
              </Typography>
            </Box>
          </>
        )}
      </Box>
    );
  };

  // 渲染主机验证步骤
  const renderHostVerifyStep = () => (
    <Box sx={{ pt: 1 }}>
      {renderHostInfo()}
      
      <Box>
        <Typography 
          variant="body2" 
          color="text.secondary" 
          sx={{ mb: 0.5 }}
        >
          {t("sshAuth.username", "用户")}:(<u>U</u>)
        </Typography>
        <TextField
          inputRef={usernameRef}
          fullWidth
          size="small"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("sshAuth.enterUsername", "请输入用户名")}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton size="small" disabled>
                  <VisibilityIcon fontSize="small" sx={{ opacity: 0.5 }} />
                </IconButton>
              </InputAdornment>
            ),
          }}
          sx={{
            "& .MuiOutlinedInput-root": {
              borderRadius: 1,
            }
          }}
        />
      </Box>
    </Box>
  );

  // 渲染凭证步骤
  const renderCredentialsStep = () => {
    // 部分隐藏用户名用于显示
    const displayUsername = username.length > 1 
      ? username[0] + "*".repeat(Math.min(username.length - 1, 3))
      : username;
    
    return (
      <>
        <Tabs
          value={credTabValue}
          onChange={(_, newValue) => setCredTabValue(newValue)}
          sx={{ 
            minHeight: 36,
            borderBottom: 1, 
            borderColor: "divider",
            "& .MuiTab-root": { minHeight: 36, py: 0 }
          }}
        >
          <Tab label={t("sshAuth.password", "密码")} />
          <Tab label={t("sshAuth.publicKey", "公钥")} />
        </Tabs>
        
        <Box sx={{ pt: 2 }}>
          {credTabValue === 0 && (
            <Box>
              <Typography 
                variant="body2" 
                color="text.secondary" 
                sx={{ mb: 0.5 }}
              >
                {t("sshAuth.password", "密码")}:(<u>P</u>)
              </Typography>
              <TextField
                inputRef={passwordRef}
                fullWidth
                size="small"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("sshAuth.enterPassword", "请输入密码")}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() => setShowPassword(!showPassword)}
                        edge="end"
                      >
                        {showPassword ? (
                          <VisibilityOffIcon fontSize="small" />
                        ) : (
                          <VisibilityIcon fontSize="small" />
                        )}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                sx={{
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 1,
                  }
                }}
              />
            </Box>
          )}
          
          {credTabValue === 1 && (
            <Box>
              <Typography 
                variant="body2" 
                color="text.secondary" 
                sx={{ mb: 0.5 }}
              >
                {t("sshAuth.privateKeyPath", "私钥路径")}:
              </Typography>
              <Box sx={{ display: "flex", gap: 1 }}>
                <TextField
                  fullWidth
                  size="small"
                  value={privateKeyPath}
                  onChange={(e) => setPrivateKeyPath(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t("sshAuth.selectKeyFile", "选择私钥文件")}
                  sx={{
                    "& .MuiOutlinedInput-root": {
                      borderRadius: 1,
                    }
                  }}
                />
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleSelectKeyFile}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  {t("sshAuth.browse", "浏览...")}
                </Button>
              </Box>
            </Box>
          )}
        </Box>
      </>
    );
  };

  // 计算标题
  const getTitle = () => {
    if (step === "credentials" && username) {
      const displayUsername = username.length > 1 
        ? username[0] + "*".repeat(Math.min(username.length - 1, 3))
        : username;
      return `${t("sshAuth.login", "登录")}：${displayUsername}`;
    }
    return t("sshAuth.login", "登录");
  };

  return (
    <Dialog
      open={open}
      onClose={handleCancel}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            minWidth: 400,
            maxWidth: 500,
            borderRadius: 2,
            border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
          }
        }
      }}
    >
      <DialogTitle
        sx={{
          textAlign: "center",
          py: 1.5,
          borderBottom: `1px solid ${theme.palette.divider}`,
          color: theme.palette.primary.main,
          fontWeight: 500,
        }}
      >
        {getTitle()}
      </DialogTitle>
      
      <DialogContent sx={{ pt: 0, pb: 1 }}>
        {step === "hostVerify" ? renderHostVerifyStep() : renderCredentialsStep()}
      </DialogContent>
      
      <Box sx={{ px: 3, pb: 1 }}>
        <FormControlLabel
          control={
            <Checkbox
              checked={autoLogin}
              onChange={(e) => setAutoLogin(e.target.checked)}
              size="small"
            />
          }
          label={
            <Typography variant="body2">
              {t("sshAuth.autoLoginNext", "下次自动登录")}(<u>A</u>)
            </Typography>
          }
        />
      </Box>
      
      <DialogActions sx={{ px: 3, py: 1.5, borderTop: `1px solid ${theme.palette.divider}` }}>
        <Button
          variant="outlined"
          onClick={step === "hostVerify" ? handleHostVerifyContinue : handleCredentialsContinue}
          disabled={
            (step === "hostVerify" && !username.trim()) ||
            (step === "credentials" && credTabValue === 0 && !password) ||
            (step === "credentials" && credTabValue === 1 && !privateKeyPath)
          }
          sx={{ minWidth: 80 }}
        >
          {t("sshAuth.continue", "继续")}
        </Button>
        <Button
          variant="outlined"
          onClick={handleCancel}
          sx={{ minWidth: 80 }}
        >
          {t("sshAuth.cancel", "取消")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SSHAuthDialog;

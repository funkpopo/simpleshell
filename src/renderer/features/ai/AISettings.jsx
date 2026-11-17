import React, { memo } from "react";
import { GlassDialog } from "../../shared/ui/styledDialogs.jsx";
import {
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Alert,
  CircularProgress,
  IconButton,
  Tabs,
  Tab,
  Tooltip,
  Divider,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslation } from "react-i18next";
import { Z_INDEX } from "../../shared/constants/zIndex.js";
import useAISettingsController from "./hooks/useAISettingsController.js";
import ApiConfigList from "./components/ApiConfigList.jsx";
import ApiConfigForm from "./components/ApiConfigForm.jsx";
import AIProxySettingsPanel from "./components/AIProxySettingsPanel.jsx";
import CustomRiskRulesTab from "./components/CustomRiskRulesTab.jsx";
import ConfirmDialog from "./components/ConfirmDialog.jsx";

const AISettings = ({ open, onClose }) => {
  const { t } = useTranslation();
  const {
    firstInputRef,
    loading,
    testing,
    fetchingModels,
    error,
    success,
    availableModels,
    tabValue,
    setTabValue,
    apiConfigs,
    currentApiId,
    editMode,
    editingConfig,
    config,
    proxy,
    rules,
    deleteConfirmOpen,
    discardRulesConfirmOpen,
    handleConfigChange,
    handleAddApi,
    handleEditApi,
    handleDeleteApi,
    handleConfirmDelete,
    handleCancelDelete,
    handleSetCurrent,
    handleCancelEdit,
    handleSave,
    handleTest,
    handleClose,
    handleConfirmDiscardRules,
    handleCancelDiscardRules,
    handleFetchModels,
  } = useAISettingsController({ open, onClose });

  return (
    <GlassDialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      paperMaxHeight="min(84vh, 780px)"
      sx={{
        zIndex: Z_INDEX.modalRaised,
        pointerEvents: "auto",
        "& .MuiDialog-container": {
          pointerEvents: "auto",
        },
      }}
      slotProps={{
        paper: {
          sx: {
            width: "min(820px, calc(100vw - 32px))",
            maxWidth: "none",
            pointerEvents: "auto",
          },
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography variant="h6" component="span">
          {t("aiSettings.title")}
        </Typography>
        <Tooltip title={t("common.close")}>
          <IconButton
            onClick={handleClose}
            size="small"
            aria-label={t("common.close")}
            sx={{ color: "text.secondary" }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, display: "flex", flexDirection: "column" }}>
        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
            <CircularProgress size={28} />
          </Box>
        )}

        {!loading && (
          <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
            {/* 标签页 */}
            <Tabs
              value={tabValue}
              onChange={(e, newValue) => setTabValue(newValue)}
              sx={{
                px: 2,
                minHeight: 40,
                borderBottom: 1,
                borderColor: "divider",
                bgcolor: "background.default",
                flexShrink: 0,
                "& .MuiTab-root": { minHeight: 40, py: 0.75, fontSize: "0.85rem" },
              }}
            >
              <Tab label={t("aiSettings.apiManagement")} />
              <Tab label={t("aiSettings.customRules")} />
            </Tabs>

            {/* 标签页内容 */}
            <Box
              className="app-scrollbar"
              sx={{
                p: 2.25,
                overflowY: "auto",
                flex: 1,
                "& > [data-ai-settings-panel]": {
                  animation:
                    "ss-ai-panel-in 180ms cubic-bezier(0.2, 0, 0, 1)",
                },
                "@keyframes ss-ai-panel-in": {
                  from: { opacity: 0, transform: "translateY(4px)" },
                  to: { opacity: 1, transform: "translateY(0)" },
                },
                "@media (prefers-reduced-motion: reduce)": {
                  "& > [data-ai-settings-panel]": {
                    animation: "none",
                  },
                },
              }}
            >
              {error && (
                <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}
              {success && (
                <Alert severity="success" variant="outlined" sx={{ mb: 2 }}>
                  {success}
                </Alert>
              )}

              {tabValue === 0 && (
                <Box data-ai-settings-panel="0">
                  {!editMode ? (
                    // API列表模式
                    <ApiConfigList
                      apiConfigs={apiConfigs}
                      currentApiId={currentApiId}
                      onAddApi={handleAddApi}
                      onSetCurrent={handleSetCurrent}
                      onEditApi={handleEditApi}
                      onDeleteApi={handleDeleteApi}
                    />
                  ) : (
                    // 编辑模式
                    <ApiConfigForm
                      config={config}
                      editingConfig={editingConfig}
                      availableModels={availableModels}
                      fetchingModels={fetchingModels}
                      firstInputRef={firstInputRef}
                      onConfigChange={handleConfigChange}
                      onFetchModels={handleFetchModels}
                    />
                  )}

                  {/* 代理配置（可展开） */}
                  <Divider sx={{ my: 2.25 }} />
                  <AIProxySettingsPanel
                    proxyConfig={proxy.proxyConfig}
                    proxySaving={proxy.proxySaving}
                    proxyExpanded={proxy.proxyExpanded}
                    setProxyExpanded={proxy.setProxyExpanded}
                    onProxyChange={proxy.handleProxyChange}
                    onSaveProxy={proxy.handleSaveProxy}
                  />
                </Box>
              )}

              {/* 自定义风险规则标签页 */}
              {tabValue === 1 && (
                <Box data-ai-settings-panel="1">
                  <CustomRiskRulesTab
                    customRules={rules.customRules}
                    newRulePattern={rules.newRulePattern}
                    setNewRulePattern={rules.setNewRulePattern}
                    newRuleLevel={rules.newRuleLevel}
                    setNewRuleLevel={rules.setNewRuleLevel}
                    ruleError={rules.ruleError}
                    saving={rules.saving}
                    dirty={rules.dirty}
                    onAddRule={rules.handleAddRule}
                    onDeleteRule={rules.handleDeleteRule}
                    onSaveRules={rules.handleSaveRules}
                  />
                </Box>
              )}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {editMode ? (
          // 编辑模式的按钮
          <>
            <Button
              onClick={handleTest}
              disabled={loading || testing}
              variant="outlined"
            >
              {testing ? t("aiSettings.testing") : t("aiSettings.test")}
            </Button>
            <Button onClick={handleCancelEdit} disabled={loading} variant="outlined">
              {t("aiSettings.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={loading} variant="contained">
              {t("aiSettings.save")}
            </Button>
          </>
        ) : (
          // 列表模式的按钮
          <Button onClick={handleClose} disabled={loading} variant="outlined">
            {t("aiSettings.cancel")}
          </Button>
        )}
      </DialogActions>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        title={t("aiSettings.deleteConfirmTitle")}
        message={t("aiSettings.deleteConfirm")}
        confirmLabel={t("common.delete")}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
      />

      {/* 放弃未保存的自定义规则确认 */}
      <ConfirmDialog
        open={discardRulesConfirmOpen}
        title={t("aiSettings.unsavedRulesTitle")}
        message={t("aiSettings.unsavedRulesMessage")}
        confirmLabel={t("aiSettings.discardRules")}
        onCancel={handleCancelDiscardRules}
        onConfirm={handleConfirmDiscardRules}
      />
    </GlassDialog>
  );
};

export default memo(AISettings);

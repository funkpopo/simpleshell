import React, { memo } from "react";
import Dialog from "../../shared/ui/AccessibleDialog.jsx";
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
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      sx={{
        zIndex: Z_INDEX.modalRaised,
        pointerEvents: "auto",
        "& .MuiDialog-container": {
          pointerEvents: "auto",
        },
      }}
      PaperProps={{
        sx: {
          width: "min(860px, calc(100vw - 32px))",
          maxWidth: "none",
          maxHeight: "min(88vh, 820px)",
          borderRadius: 2,
          backdropFilter: "blur(10px)",
          pointerEvents: "auto",
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
          >
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {!loading && (
          <Box>
            {/* 标签页 */}
            <Tabs
              value={tabValue}
              onChange={(e, newValue) => setTabValue(newValue)}
              sx={{ borderBottom: 1, borderColor: "divider" }}
            >
              <Tab label={t("aiSettings.apiManagement")} />
              <Tab label={t("aiSettings.customRules")} />
            </Tabs>

            {/* 标签页内容 */}
            <Box sx={{ p: 3 }}>
              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}
              {success && (
                <Alert severity="success" sx={{ mb: 2 }}>
                  {success}
                </Alert>
              )}

              {tabValue === 0 && (
                <Box>
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
                  <Divider sx={{ my: 3 }} />
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
              )}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
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
            <Button onClick={handleCancelEdit} disabled={loading}>
              {t("aiSettings.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={loading} variant="contained">
              {t("aiSettings.save")}
            </Button>
          </>
        ) : (
          // 列表模式的按钮
          <Button onClick={handleClose} disabled={loading}>
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
    </Dialog>
  );
};

export default memo(AISettings);

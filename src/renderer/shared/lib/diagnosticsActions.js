/**
 * 诊断/反馈相关的共享操作。
 * app.jsx（系统菜单）与 Settings.jsx（设置面板）复用同一套逻辑，
 * 差异（反馈来源、确认按钮文案等）通过参数注入。
 */

export const openLogDirectory = async ({ t, showSuccess, showError }) => {
  try {
    const result = await window.terminalAPI?.openLogDirectory?.();
    if (result?.success === false) {
      throw new Error(result.error || t("settings.openLogDirectoryFailed"));
    }
    showSuccess(t("settings.logDirectoryOpened"));
  } catch (error) {
    showError(error?.message || t("settings.openLogDirectoryFailed"));
  }
};

export const exportDiagnostics = async ({ t, showSuccess, showError }) => {
  try {
    const result = await window.terminalAPI?.exportDiagnostics?.();
    if (result?.success === false) {
      throw new Error(result.error || t("settings.exportDiagnosticsFailed"));
    }
    showSuccess(
      t("settings.diagnosticsExported", {
        path: result?.filePath || "",
      }),
    );
  } catch (error) {
    showError(error?.message || t("settings.exportDiagnosticsFailed"));
  }
};

export const openFeedbackIssue = async ({
  t,
  showSuccess,
  showError,
  source,
  confirmButtonLabel,
}) => {
  try {
    if (!window.dialogAPI?.showMessageBox) {
      throw new Error(t("settings.feedback.dialogUnavailable"));
    }

    const confirmation = await window.dialogAPI.showMessageBox({
      type: "info",
      buttons: [t("settings.feedback.cancel"), confirmButtonLabel],
      defaultId: 1,
      cancelId: 0,
      title: t("settings.feedback.confirmTitle"),
      message: t("settings.feedback.confirmMessage"),
      detail: t("settings.feedback.confirmDetail"),
      noLink: true,
    });
    if (confirmation?.response !== 1) {
      return;
    }

    const result = await window.terminalAPI?.openFeedbackIssue?.({
      source,
      title: t("settings.feedback.defaultTitle"),
    });
    if (result?.success === false) {
      throw new Error(result.error || t("settings.feedback.openIssueFailed"));
    }
    showSuccess(t("settings.feedback.issueOpened"));
  } catch (error) {
    showError(error?.message || t("settings.feedback.openIssueFailed"));
  }
};

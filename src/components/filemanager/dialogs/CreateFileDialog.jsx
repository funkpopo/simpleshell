import NameInputDialog from "../../NameInputDialog.jsx";
// TransferProgressFloat 已移至全局显示,不再导入
import { useTranslation } from "react-i18next";
export default function CreateFileDialog({
  showCreateFileDialog,
  handleCloseCreateFileDialog,
  handleCreateFileSubmit,
  newFileName,
  setNewFileName,
  createFileDialogError,
  createFileSubmitting,
}) {
  const { t } = useTranslation();
  if (!showCreateFileDialog) return null;
  return (
    <NameInputDialog
      open={showCreateFileDialog}
      onClose={handleCloseCreateFileDialog}
      onSubmit={handleCreateFileSubmit}
      title={t("fileManager.createFile")}
      label={t("fileManager.createFile")}
      value={newFileName}
      onValueChange={setNewFileName}
      errorText={createFileDialogError}
      submitting={createFileSubmitting}
    />
  );
}

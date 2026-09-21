import NameInputDialog from "../../../shared/ui/NameInputDialog.jsx";
// TransferProgressFloat 已移至全局显示,不再导入
import { useTranslation } from "react-i18next";
export default function RenameDialog({
  showRenameDialog,
  handleCloseRenameDialog,
  handleRenameSubmit,
  newName,
  setNewName,
  renameDialogError,
  renameSubmitting,
}) {
  const { t } = useTranslation();
  if (!showRenameDialog) return null;
  return (
    <NameInputDialog
      open={showRenameDialog}
      onClose={handleCloseRenameDialog}
      onSubmit={handleRenameSubmit}
      title={t("fileManager.editFileOrFolder")}
      label={t("fileManager.newName")}
      value={newName}
      onValueChange={setNewName}
      errorText={renameDialogError}
      submitting={renameSubmitting}
      maxWidth="sm"
    />
  );
}

import NameInputDialog from "../../NameInputDialog.jsx";
// TransferProgressFloat 已移至全局显示,不再导入
import { useTranslation } from "react-i18next";
export default function CreateFolderDialog({
  showCreateFolderDialog,
  handleCloseCreateFolderDialog,
  handleCreateFolderSubmit,
  newFolderName,
  setNewFolderName,
  createFolderDialogError,
  createFolderSubmitting,
}) {
  const { t } = useTranslation();
  if (!showCreateFolderDialog) return null;
  return (
    <NameInputDialog
      open={showCreateFolderDialog}
      onClose={handleCloseCreateFolderDialog}
      onSubmit={handleCreateFolderSubmit}
      title={t("fileManager.createFolder")}
      label={t("fileManager.createFolder")}
      value={newFolderName}
      onValueChange={setNewFolderName}
      errorText={createFolderDialogError}
      submitting={createFolderSubmitting}
    />
  );
}

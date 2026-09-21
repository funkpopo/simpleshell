import RenameDialog from "./RenameDialog.jsx";
import CreateFileDialog from "./CreateFileDialog.jsx";
import CreateFolderDialog from "./CreateFolderDialog.jsx";
import PermissionDialog from "./PermissionDialog.jsx";
import PropertiesDialog from "./PropertiesDialog.jsx";
import PreviewDialog from "./PreviewDialog.jsx";

/** Dialog views consume their own models, never the live navigation or selection. */
export default function FileManagerDialogs({
  rename,
  createFile,
  createFolder,
  permissions,
  properties,
  preview,
}) {
  return (
    <>
      <RenameDialog
        showRenameDialog={rename.open}
        handleCloseRenameDialog={rename.close}
        handleRenameSubmit={rename.submit}
        newName={rename.name}
        setNewName={rename.setName}
        renameDialogError={rename.error}
        renameSubmitting={rename.submitting}
      />
      <CreateFileDialog
        showCreateFileDialog={createFile.open}
        handleCloseCreateFileDialog={createFile.close}
        handleCreateFileSubmit={createFile.submit}
        newFileName={createFile.name}
        setNewFileName={createFile.setName}
        createFileDialogError={createFile.error}
        createFileSubmitting={createFile.submitting}
      />
      <CreateFolderDialog
        showCreateFolderDialog={createFolder.open}
        handleCloseCreateFolderDialog={createFolder.close}
        handleCreateFolderSubmit={createFolder.submit}
        newFolderName={createFolder.name}
        setNewFolderName={createFolder.setName}
        createFolderDialogError={createFolder.error}
        createFolderSubmitting={createFolder.submitting}
      />
      <PermissionDialog {...permissions} />
      <PropertiesDialog {...properties} />
      <PreviewDialog {...preview} />
    </>
  );
}

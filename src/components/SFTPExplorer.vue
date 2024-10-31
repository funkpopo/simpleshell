<template>
  <div class="sftp-explorer">
    <div class="sftp-header">
      <h3>{{ $t('sftp.explorer') }}</h3>
      <div class="sftp-actions">
        <a-button size="small" @click="goToBase">
          <template #icon>
            <icon-home />
          </template>
          /
        </a-button>
        <a-button size="small" @click="refreshCurrentDirectory">
          <template #icon>
            <icon-refresh />
          </template>
          {{ $t('sftp.refresh') }}
        </a-button>
        <a-button size="small" @click="showHistory">{{ $t('sftp.history') }}</a-button>
      </div>
    </div>
    <div class="sftp-content">
      <a-spin :loading="loading">
        <a-tree
          v-if="fileTree.length > 0"
          :data="fileTree"
          :loadMore="loadMoreData"
          @select="onSelect"
          :defaultExpandedKeys="['root']"
        >
          <template #icon="nodeData">
            <icon-file v-if="nodeData.isLeaf" class="file-icon" />
            <icon-folder v-else class="folder-icon" />
          </template>
          <template #title="nodeData">
            <span
              :class="{
                'folder-drop-target': !nodeData.isLeaf,
                'file-name': nodeData.isLeaf,
                'folder-name': !nodeData.isLeaf
              }"
              @dblclick="onItemDoubleClick(nodeData)"
              @dragover.prevent
              @drop.prevent="(event) => onDrop(event, nodeData)"
              @contextmenu.prevent="(event) => showContextMenu(event, nodeData)"
            >
              {{ nodeData.title }}
            </span>
          </template>
        </a-tree>
        <div v-else-if="!loading">No files or directories found.</div>
      </a-spin>
    </div>
    <a-modal v-model:visible="fileContentVisible" title="File Content">
      <pre>{{ fileContent }}</pre>
    </a-modal>
    <a-modal v-model:visible="historyVisible" title="SFTP Operation History">
      <pre>{{ historyContent }}</pre>
    </a-modal>
    <input
      type="file"
      ref="fileInput"
      style="display: none;"
      @change="handleFileUpload"
      multiple
    >
    <a-modal v-model:visible="renameModalVisible" title="Rename">
      <a-input v-model="newName" placeholder="Enter new name" />
      <template #footer>
        <a-button @click="renameModalVisible = false">Cancel</a-button>
        <a-button type="primary" @click="confirmRename">Confirm</a-button>
      </template>
    </a-modal>
    <a-modal v-model:visible="newFolderModalVisible" title="New Folder">
      <a-input v-model="newFolderName" placeholder="Enter folder name" />
      <template #footer>
        <a-button @click="newFolderModalVisible = false">Cancel</a-button>
        <a-button type="primary" @click="confirmCreateFolder">Create</a-button>
      </template>
    </a-modal>
  </div>
</template>

<script>
import { ref, onMounted, watch, inject } from 'vue';
import { IconFile, IconFolder, IconRefresh, IconHome } from '@arco-design/web-vue/es/icon';
import axios from 'axios';
import { Message } from '@arco-design/web-vue';
import { Menu, MenuItem, getCurrentWindow, shell, dialog } from '@electron/remote';
import path from 'path';
import fs from 'fs';

export default {
  name: 'SFTPExplorer',
  components: {
    IconFile,
    IconFolder,
    IconRefresh,
    IconHome
  },
  props: {
    connection: {
      type: Object,
      required: true
    }
  },
  setup(props) {
    const fileTree = ref([]);
    const loading = ref(false);
    const fileContentVisible = ref(false);
    const fileContent = ref('');
    const fileInput = ref(null);
    const historyVisible = ref(false);
    const historyContent = ref('');
    const currentDirectory = ref('/');
    const renameModalVisible = ref(false);
    const newName = ref('');
    const itemToRename = ref(null);
    const currentUploadPath = ref('/');
    const expandedKeys = ref([]);
    const newFolderModalVisible = ref(false);
    const newFolderName = ref('');
    const currentFolderPath = ref('');
    const i18n = inject('i18n');

    const normalizePath = (path) => {
      return path.replace(/\\/g, '/').replace(/\/+/g, '/');
    };

    const sortItems = (items) => {
      return items.sort((a, b) => {
        // 首先按照是否为目录排序
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        // 然后按照名字母顺序排序
        return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      });
    };

    const fetchRootDirectory = async () => {
      loading.value = true;
      try {
        const response = await axios.post('http://localhost:5000/sftp_list_directory', {
          connection: props.connection,
          path: '/',
          forceRoot: true
        });
        console.log('Root directory response:', response.data);
        if (response.data.error) {
          throw new Error(response.data.error);
        }
        const sortedItems = sortItems(response.data.map(item => ({
          title: item.name,
          key: normalizePath('/' + item.name),
          isLeaf: !item.isDirectory,
          children: item.isDirectory ? [] : undefined
        })));
        fileTree.value = [{
          title: '/',
          key: 'root',
          isLeaf: false,
          children: sortedItems
        }];
        console.log('Processed file tree:', fileTree.value);
      } catch (error) {
        console.error('Failed to fetch root directory:', error);
        Message.error(`Failed to fetch root directory: ${error.message}`);
        fileTree.value = [];
      } finally {
        loading.value = false;
      }
    };

    const loadMoreData = async (node) => {
      if (node.children && node.children.length > 0) return;
      
      try {
        const path = node.key === 'root' ? '/' : normalizePath(node.key);
        console.log('Attempting to load directory:', path);
        const response = await axios.post('http://localhost:5000/sftp_list_directory', {
          connection: props.connection,
          path: path
        });
        if (response.data.error) {
          throw new Error(response.data.error);
        }
        console.log('Directory contents:', response.data);
        node.children = sortItems(response.data.map(item => ({
          title: item.name,
          key: normalizePath(path + '/' + item.name),
          isLeaf: !item.isDirectory,
          children: item.isDirectory ? [] : undefined
        })));
      } catch (error) {
        console.error('Failed to fetch directory contents:', error);
        if (error.response) {
          console.error('Error response:', error.response.data);
          Message.error(`Failed to fetch directory contents: ${error.response.data.error || error.message}`);
        } else {
          Message.error(`Failed to fetch directory contents: ${error.message}`);
        }
      }
    };

    const onSelect = (selectedKeys, { selectedNodes }) => {
      if (selectedNodes.length > 0) {
        const node = selectedNodes[0];
        currentDirectory.value = normalizePath(node.key === 'root' ? '/' : node.key);
        if (!node.isLeaf) {
          loadMoreData(node);
        }
      }
    };

    const onItemClick = async (data) => {
      if (data.isLeaf) {
        try {
          const response = await axios.post('http://localhost:5000/sftp_read_file', {
            connection: props.connection,
            path: normalizePath(data.key)
          });
          fileContent.value = response.data;
          fileContentVisible.value = true;
          await logOperation('read', normalizePath(data.key));
        } catch (error) {
          console.error('Failed to read file:', error);
          Message.error('Failed to read file');
        }
      }
    };

    const onDrop = async (event, targetNode) => {
      if (targetNode.isLeaf) {
        Message.error('Cannot upload to a file. Please choose a folder.');
        return;
      }

      const files = event.dataTransfer.files;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const base64Content = e.target.result.split(',')[1]; // 获取 Base64 编码的容
            await axios.post('http://localhost:5000/sftp_upload_file', {
              connection: props.connection,
              path: normalizePath(targetNode.key === 'root' ? '/' : targetNode.key),
              filename: file.name,
              content: base64Content
            });
            Message.success(`Uploaded ${file.name} successfully`);
            // Refresh the target directory
            await loadMoreData(targetNode);
            await logOperation('upload', `${targetNode.key}/${file.name}`);
          } catch (error) {
            console.error('Failed to upload file:', error);
            Message.error(`Failed to upload ${file.name}`);
          }
        };
        reader.readAsDataURL(file); // 使用 readAsDataURL 而不是 readAsArrayBuffer
      }
    };

    const openFileUpload = (nodeData) => {
      if (nodeData.isLeaf) {
        currentUploadPath.value = normalizePath(nodeData.key.substring(0, nodeData.key.lastIndexOf('/')));
      } else {
        currentUploadPath.value = normalizePath(nodeData.key);
      }
      currentUploadPath.value = currentUploadPath.value === 'root' ? '/' : currentUploadPath.value;
      console.log('Opening file upload. Current upload path:', currentUploadPath.value);
      fileInput.value.click();
    };

    const handleFileUpload = async (event) => {
      const files = event.target.files;
      if (!files.length) return;

      const uploadPath = currentUploadPath.value;
      console.log('Handling file upload. Upload path:', uploadPath);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const base64Content = e.target.result.split(',')[1];
            console.log('Uploading file:', file.name, 'to path:', uploadPath);
            const response = await axios.post('http://localhost:5000/sftp_upload_file', {
              connection: props.connection,
              path: uploadPath,
              filename: file.name,
              content: base64Content
            });
            console.log('Upload response:', response.data);
            Message.success(`Uploaded ${file.name} successfully`);
            // 刷新当前目录，保持展开状态
            await refreshDirectoryKeepingState(uploadPath);
          } catch (error) {
            console.error('Failed to upload file:', error);
            Message.error(`Failed to upload ${file.name}: ${error.message}`);
          }
        };
        reader.readAsDataURL(file);
      }
      // Reset the file input
      event.target.value = '';
    };

    const refreshDirectoryKeepingState = async (path) => {
      try {
        loading.value = true;
        console.log('Refreshing directory:', path);
        const response = await axios.post('http://localhost:5000/sftp_list_directory', {
          connection: props.connection,
          path: path
        });
        
        if (response.data.error) {
          throw new Error(response.data.error);
        }

        const updateNode = (node, newChildren) => {
          if (node.key === path) {
            node.children = newChildren;
            return true;
          }
          if (node.children) {
            for (let child of node.children) {
              if (updateNode(child, newChildren)) {
                return true;
              }
            }
          }
          return false;
        };

        const newChildren = sortItems(response.data.map(item => ({
          title: item.name,
          key: normalizePath(path + '/' + item.name),
          isLeaf: !item.isDirectory,
          children: item.isDirectory ? [] : undefined
        })));

        updateNode(fileTree.value[0], newChildren);

        console.log('Directory refreshed:', path);
        Message.success(`Refreshed ${path}`);
      } catch (error) {
        console.error('Failed to refresh directory:', error);
        Message.error('Failed to refresh directory');
      } finally {
        loading.value = false;
      }
    };

    const onExpand = (keys) => {
      expandedKeys.value = keys;
    };

    const showContextMenu = (event, nodeData) => {
      event.preventDefault();
      const menu = new Menu();
      
      // 只有在右键点击文件夹时才显示新建文件夹选项
      if (!nodeData.isLeaf) {
        menu.append(new MenuItem({
          label: 'New Folder',
          click: () => createNewFolder(nodeData)
        }));

        menu.append(new MenuItem({
          label: 'Upload',
          click: () => openFileUpload(nodeData)
        }));

        menu.append(new MenuItem({ type: 'separator' }));
      }

      menu.append(new MenuItem({
        label: 'Refresh',
        click: () => refreshDirectory(nodeData)
      }));

      menu.append(new MenuItem({
        label: 'Rename',
        click: () => showRenameModal(nodeData)
      }));

      // 如果是文件，显示下载选项
      if (nodeData.isLeaf) {
        menu.append(new MenuItem({
          label: 'Download',
          click: () => downloadItem(nodeData)
        }));
      }

      // 添加分隔线
      menu.append(new MenuItem({ type: 'separator' }));

      // 修改删除选项
      menu.append(new MenuItem({
        label: `Delete ${nodeData.isLeaf ? 'File' : 'Folder'}`,
        click: () => deleteSelectedItem(nodeData),
        type: 'normal',
        role: 'delete'
      }));

      menu.popup();
    };

    const deleteSelectedItem = async (item) => {
      if (item) {
        try {
          // 使用更醒目的确认对话框
          const result = await dialog.showMessageBox({
            type: 'warning',
            title: 'Confirm Delete',
            message: `Are you sure you want to delete "${item.title}"?`,
            detail: 'This action cannot be undone.',
            buttons: ['Cancel', 'Delete'],
            defaultId: 0,
            cancelId: 0,
            icon: path.join(__dirname, 'warning-icon.png') // 可以添加自定义警告图标
          });

          if (result.response === 1) { // 用户点击 Delete
            const response = await axios.post('http://localhost:5000/sftp_delete_item', {
              connection: props.connection,
              path: item.key
            });
            if (response.data.error) {
              throw new Error(response.data.error);
            }
            Message.success(`Deleted ${item.title} successfully`);
            
            const parentKey = item.key.split('/').slice(0, -1).join('/') || '/';
            await refreshDirectoryKeepingState(parentKey);
            await logOperation('delete', item.key);
          }
        } catch (error) {
          console.error('Failed to delete item:', error);
          Message.error(`Failed to delete ${item.title}: ${error.message}`);
        }
      }
    };

    const expandToPath = async (path) => {
      const pathParts = path.split('/').filter(Boolean);
      let currentNode = fileTree.value[0]; // 根节点
      
      for (const part of pathParts) {
        if (currentNode.children) {
          await loadMoreData(currentNode);
          currentNode = currentNode.children.find(child => child.title === part);
          if (!currentNode) break;
        } else {
          break;
        }
      }
      
      if (currentNode) {
        currentNode.expanded = true;
      }
    };

    const logOperation = async (operation, path) => {
      try {
        await axios.post('http://localhost:5000/log_sftp_operation', {
          operation,
          path,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('Failed to log SFTP operation:', error);
      }
    };

    const refreshCurrentDirectory = async () => {
      try {
        loading.value = true;
        const path = currentDirectory.value === 'root' ? '/' : currentDirectory.value;
        const response = await axios.post('http://localhost:5000/sftp_list_directory', {
          connection: props.connection,
          path: path
        });
        
        // 更新当前目录的内容
        const currentNode = findNodeByKey(fileTree.value[0], currentDirectory.value);
        if (currentNode) {
          currentNode.children = response.data.map(item => ({
            title: item.name,
            key: normalizePath(item.path),
            isLeaf: !item.isDirectory,
            children: item.isDirectory ? [] : undefined
          }));
        }
        
        Message.success('Directory refreshed');
      } catch (error) {
        console.error('Failed to refresh directory:', error);
        Message.error('Failed to refresh directory');
      } finally {
        loading.value = false;
      }
    };

    const refreshDirectory = async (node) => {
      try {
        loading.value = true;
        const path = node.key === 'root' ? '/' : node.key;
        console.log('Refreshing directory:', path);
        const response = await axios.post('http://localhost:5000/sftp_list_directory', {
          connection: props.connection,
          path: path
        });
        
        if (node.key === 'root') {
          fileTree.value[0].children = response.data.map(item => ({
            title: item.name,
            key: item.path,
            isLeaf: !item.isDirectory,
            children: item.isDirectory ? [] : undefined
          }));
        } else {
          const parentNode = findParentNode(fileTree.value[0], node.key);
          if (parentNode) {
            const index = parentNode.children.findIndex(child => child.key === node.key);
            if (index !== -1) {
              parentNode.children[index].children = response.data.map(item => ({
                title: item.name,
                key: item.path,
                isLeaf: !item.isDirectory,
                children: item.isDirectory ? [] : undefined
              }));
            }
          }
        }
        
        console.log('Directory refreshed:', path);
        Message.success(`Refreshed ${node.title}`);
      } catch (error) {
        console.error('Failed to refresh directory:', error);
        Message.error('Failed to refresh directory');
      } finally {
        loading.value = false;
      }
    };

    const findNodeByKey = (node, key) => {
      if (node.key === key) return node;
      if (node.children) {
        for (let child of node.children) {
          const result = findNodeByKey(child, key);
          if (result) return result;
        }
      }
      return null;
    };

    const findParentNode = (node, key) => {
      if (node.children) {
        for (let child of node.children) {
          if (child.key === key) {
            return node;
          }
          const result = findParentNode(child, key);
          if (result) {
            return result;
          }
        }
      }
      return null;
    };

    const showHistory = async () => {
      try {
        const response = await axios.get('http://localhost:5000/get_sftp_history');
        historyContent.value = response.data;
        historyVisible.value = true;
      } catch (error) {
        console.error('Failed to fetch SFTP history:', error);
        Message.error('Failed to fetch SFTP history');
      }
    };

    const showRenameModal = (node) => {
      itemToRename.value = node;
      newName.value = node.title;
      renameModalVisible.value = true;
    };

    const confirmRename = async () => {
      if (!itemToRename.value || !newName.value) return;

      try {
        const oldPath = itemToRename.value.key;
        const newPath = oldPath.substring(0, oldPath.lastIndexOf('/') + 1) + newName.value;

        await axios.post('http://localhost:5000/sftp_rename_item', {
          connection: props.connection,
          oldPath: oldPath,
          newPath: newPath
        });

        Message.success(`Renamed successfully`);
        renameModalVisible.value = false;

        // Refresh the parent directory
        const parentKey = oldPath.split('/').slice(0, -1).join('/') || '/';
        await refreshDirectory({ key: parentKey });

        await logOperation('rename', `${oldPath} to ${newPath}`);
      } catch (error) {
        console.error('Failed to rename item:', error);
        Message.error(`Failed to rename: ${error.message}`);
      }
    };

    const onItemDoubleClick = async (data) => {
      if (data.isLeaf) {
        try {
          console.log('Attempting to download file:', data.key);
          const response = await axios.post('http://localhost:5000/sftp_download_file', {
            connection: props.connection,
            path: data.key
          }, {
            responseType: 'blob'
          });

          console.log('File download response received');
          const tempDir = path.join(process.cwd(), 'temp');
          const tempFilePath = path.join(tempDir, data.title);

          // 将文件保存到临时目录
          fs.writeFileSync(tempFilePath, Buffer.from(await response.data.arrayBuffer()));

          console.log('File downloaded, attempting to open');
          Message.success(`File ${data.title} downloaded successfully`);

          // 直接打开文件
          shell.openPath(tempFilePath);
        } catch (error) {
          console.error('Failed to download and open file:', error);
          if (error.response) {
            console.error('Error response:', error.response.data);
            if (error.response.status === 404) {
              Message.error(`File not found: ${data.key}`);
            } else {
              Message.error(`Failed to download and open file: ${error.response.data.error || error.message}`);
            }
          } else {
            Message.error(`Failed to download and open file: ${error.message}`);
          }
        }
      }
    };

    const goToBase = async () => {
      try {
        await fetchRootDirectory();
        currentDirectory.value = '/';
        Message.success('Switched to base directory');
      } catch (error) {
        console.error('Failed to switch to base directory:', error);
        Message.error('Failed to switch to base directory');
      }
    };

    const downloadFile = async (nodeData) => {
      try {
        const savePath = await dialog.showSaveDialog({
          title: 'Save file',
          defaultPath: nodeData.title,
          buttonLabel: 'Save'
        });

        if (savePath.canceled) {
          return;
        }

        const response = await axios.post('http://localhost:5000/sftp_download_file', {
          connection: props.connection,
          path: nodeData.key
        }, {
          responseType: 'blob'
        });

        fs.writeFileSync(savePath.filePath, Buffer.from(await response.data.arrayBuffer()));

        Message.success(`File ${nodeData.title} downloaded successfully`);
        await logOperation('download', nodeData.key);
      } catch (error) {
        console.error('Failed to download file:', error);
        if (error.response) {
          console.error('Error response:', error.response.data);
          Message.error(`Failed to download file: ${error.response.data.error || error.message}`);
        } else {
          Message.error(`Failed to download file: ${error.message}`);
        }
      }
    };

    const downloadItem = async (nodeData) => {
      try {
        const savePath = await dialog.showSaveDialog({
          title: 'Save item',
          defaultPath: nodeData.title + (nodeData.isLeaf ? '' : '.zip'),
          buttonLabel: 'Save'
        });

        if (savePath.canceled) {
          return;
        }

        const response = await axios.post('http://localhost:5000/sftp_download_item', {
          connection: props.connection,
          path: nodeData.key,
          isDirectory: !nodeData.isLeaf
        }, {
          responseType: 'blob'
        });

        fs.writeFileSync(savePath.filePath, Buffer.from(await response.data.arrayBuffer()));

        Message.success(`${nodeData.isLeaf ? 'File' : 'Folder'} ${nodeData.title} downloaded successfully`);
        await logOperation('download', nodeData.key);
      } catch (error) {
        console.error('Failed to download item:', error);
        Message.error(`Failed to download ${nodeData.title}: ${error.message}`);
      }
    };

    const createNewFolder = (nodeData) => {
      newFolderName.value = '';
      currentFolderPath.value = nodeData.isLeaf 
        ? path.dirname(nodeData.key)
        : nodeData.key;
      newFolderModalVisible.value = true;
    };

    const confirmCreateFolder = async () => {
      if (!newFolderName.value.trim()) {
        Message.error('Please enter a folder name');
        return;
      }

      try {
        const folderPath = normalizePath(`${currentFolderPath.value}/${newFolderName.value}`);
        const response = await axios.post('http://localhost:5000/sftp_create_folder', {
          connection: props.connection,
          path: folderPath
        });

        if (response.data.error) {
          throw new Error(response.data.error);
        }

        Message.success('Folder created successfully');
        newFolderModalVisible.value = false;

        // 刷新当前目录
        await refreshDirectoryKeepingState(currentFolderPath.value);
        await logOperation('create_folder', folderPath);
      } catch (error) {
        console.error('Failed to create folder:', error);
        Message.error(`Failed to create folder: ${error.message}`);
      }
    };

    onMounted(() => {
      console.log('SFTPExplorer mounted, connection:', props.connection);
      fetchRootDirectory();
    });

    watch(() => props.connection, (newConnection) => {
      console.log('Connection changed:', newConnection);
      fetchRootDirectory();
    });

    return {
      fileTree,
      loading,
      loadMoreData,
      onSelect,
      onItemClick,
      onDrop,
      fileContentVisible,
      fileContent,
      fileInput,
      openFileUpload,
      handleFileUpload,
      showContextMenu,
      deleteSelectedItem,
      expandToPath,
      historyVisible,
      historyContent,
      showHistory,
      refreshCurrentDirectory,
      refreshDirectory,
      currentDirectory,
      renameModalVisible,
      newName,
      showRenameModal,
      confirmRename,
      findNodeByKey,
      onItemDoubleClick,
      normalizePath,
      fetchRootDirectory,
      goToBase,
      sortItems,
      expandedKeys,
      onExpand,
      refreshDirectoryKeepingState,
      downloadFile,
      downloadItem,
      newFolderModalVisible,
      newFolderName,
      createNewFolder,
      confirmCreateFolder,
      t: i18n.t
    };
  }
};
</script>

<style scoped>
.sftp-explorer {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: var(--color-text-1);
}

.sftp-header {
  flex: 0 0 auto;
  padding: 10px;
}

.sftp-content {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 0 10px;
}

.folder-drop-target {
  cursor: pointer;
}

.folder-drop-target:hover {
  background-color: var(--color-fill-2);
}

:deep(.arco-tree-node-title) {
  color: var(--color-text-1);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

:deep(.arco-tree-node-icon) {
  color: var(--color-text-2);
}

.sftp-actions {
  display: flex;
  gap: 8px;
}

.sftp-actions .arco-btn {
  padding: 0 8px;
}

.sftp-actions .arco-btn .arco-icon {
  margin-right: 4px;
}

/* 自定义滚动条样式 */
.sftp-content::-webkit-scrollbar {
  width: 8px;
}

.sftp-content::-webkit-scrollbar-track {
  background: var(--color-fill-2);
}

.sftp-content::-webkit-scrollbar-thumb {
  background-color: var(--color-fill-3);
  border-radius: 4px;
  border: 2px solid var(--color-fill-2);
}

.sftp-content::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-fill-4);
}

.file-icon {
  color: var(--color-text-3);
}

.folder-icon {
  color: var(--color-primary-light-4);
}

.file-name {
  color: var(--color-text-2);
}

.folder-name {
  color: var(--color-primary-light-4);
  font-weight: bold;
}

:deep(.arco-tree-node-title) {
  color: var(--color-text-1);
  display: flex;
  align-items: center;
}

:deep(.arco-tree-node-icon) {
  margin-right: 8px;
}

:deep(.arco-tree-node-selected) .file-name,
:deep(.arco-tree-node-selected) .folder-name {
  color: var(--color-primary);
}

:deep(.arco-tree-node:hover) .file-name,
:deep(.arco-tree-node:hover) .folder-name {
  color: var(--color-primary-light-3);
}

/* 可以添加一些样式来美化新文件夹对话框 */
.arco-modal-content .arco-input {
  margin-bottom: 16px;
}
</style>


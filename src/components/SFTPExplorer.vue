<template>
  <div class="sftp-explorer">
    <div class="sftp-header">
      <h3>SFTP Explorer</h3>
      <div class="sftp-actions">
        <a-button-group>
          <a-button type="primary" @click="refreshCurrentDirectory">
            <template #icon><icon-refresh /></template>
            Refresh
          </a-button>
          <a-button type="primary" @click="showHistory">
            <template #icon><icon-history /></template>
            History
          </a-button>
        </a-button-group>
      </div>
    </div>
    <div class="sftp-content">
      <a-spin :loading="loading">
        <template v-if="fileTree && fileTree.length > 0">
          <a-tree
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
                  'folder-name': !nodeData.isLeaf,
                  'hidden-file': nodeData.isHidden
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
        </template>
        <div v-else-if="!loading" class="empty-state">
          No files or directories found.
        </div>
      </a-spin>
    </div>

    <!-- 模态框 -->
    <a-modal v-model:visible="fileContentVisible" title="File Content">
      <pre>{{ fileContent }}</pre>
    </a-modal>

    <a-modal 
      v-model:visible="historyVisible" 
      :title="t('sftp.historyTitle')"
      :width="modalWidth"
      :mask-closable="true"
      :footer="null"
      class="history-modal"
    >
      <div class="history-container">
        <div class="history-toolbar">
          <a-button type="primary" size="small" @click="refreshHistory">
            <template #icon><icon-refresh /></template>
            {{ t('sftp.refresh') }}
          </a-button>
          <a-button type="primary" size="small" @click="clearHistory">
            <template #icon><icon-delete /></template>
            {{ t('sftp.clearHistory') }}
          </a-button>
        </div>
        <div class="history-content">
          <a-table
            :columns="historyColumns"
            :data="parsedHistory"
            :pagination="{
              pageSize: pageSize,
              total: parsedHistory.length,
              showTotal: true
            }"
            :bordered="false"
            :stripe="true"
            size="small"
            :scroll="{ y: tableHeight }"
          >
            <template #cell="{ column, record }">
              <template v-if="column.dataIndex === 'time'">
                {{ formatTime(record.time) }}
              </template>
              <template v-else-if="column.dataIndex === 'operation'">
                <a-tag :color="getOperationColor(record.operation)">
                  {{ record.operation }}
                </a-tag>
              </template>
              <template v-else>
                {{ record[column.dataIndex] }}
              </template>
            </template>
          </a-table>
        </div>
      </div>
    </a-modal>

    <input
      type="file"
      ref="fileInput"
      style="display: none;"
      @change="handleFileUpload"
      multiple
    >

    <a-modal v-model:visible="renameModalVisible" :title="t('sftp.rename')">
      <a-input v-model="newName" :placeholder="t('sftp.enterNewName')" />
      <template #footer>
        <a-button @click="renameModalVisible = false">{{ t('sftp.cancel') }}</a-button>
        <a-button type="primary" @click="confirmRename">{{ t('sftp.confirm') }}</a-button>
      </template>
    </a-modal>

    <a-modal v-model:visible="newFolderModalVisible" :title="t('sftp.newFolder')">
      <a-input v-model="newFolderName" :placeholder="t('sftp.enterFolderName')" />
      <template #footer>
        <a-button @click="newFolderModalVisible = false">{{ t('sftp.cancel') }}</a-button>
        <a-button type="primary" @click="confirmCreateFolder">{{ t('sftp.createFolder') }}</a-button>
      </template>
    </a-modal>
  </div>
</template>

<script>
import { ref, onMounted, watch, inject, onUnmounted } from 'vue';
import { IconFile, IconFolder, IconRefresh, IconHome } from '@arco-design/web-vue/es/icon';
import axios from 'axios';
import { Message, Modal } from '@arco-design/web-vue';
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
    const expandedKeys = ref(['root']);
    const newFolderModalVisible = ref(false);
    const newFolderName = ref('');
    const currentFolderPath = ref('');
    const i18n = inject('i18n');

    const historyColumns = [
      {
        title: 'Time',
        dataIndex: 'time',
      },
      {
        title: 'Operation',
        dataIndex: 'operation',
      },
      {
        title: 'Path',
        dataIndex: 'path',
        ellipsis: true
      }
    ]

    const parsedHistory = ref([])

    const formatTime = (timeStr) => {
      const date = new Date(timeStr)
      return date.toLocaleString()
    }

    const getOperationColor = (operation) => {
      const colors = {
        upload: 'green',
        download: 'blue',
        delete: 'red',
        rename: 'orange',
        create_folder: 'purple'
      }
      return colors[operation] || 'default'
    }

    const refreshHistory = async () => {
      try {
        const response = await axios.get('http://localhost:5000/get_sftp_history')
        const lines = response.data.trim().split('\n')
        parsedHistory.value = lines.map(line => {
          const [time, operation, path] = line.split(',')
          return { time, operation, path }
        }).reverse() // 最新的记录显示在前面
        Message.success('History refreshed')
      } catch (error) {
        console.error('Failed to fetch SFTP history:', error)
        Message.error('Failed to fetch history')
      }
    }

    const clearHistory = async () => {
      try {
        await axios.post('http://localhost:5000/clear_sftp_history')
        parsedHistory.value = []
        Message.success('History cleared')
      } catch (error) {
        console.error('Failed to clear SFTP history:', error)
        Message.error('Failed to clear history')
      }
    }

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
          forceRoot: true,
          showHidden: true
        });
        console.log('Root directory response:', response.data);
        if (response.data.error) {
          throw new Error(response.data.error);
        }
        const sortedItems = sortItems(response.data.map(item => ({
          title: item.name,
          key: normalizePath('/' + item.name),
          isLeaf: !item.isDirectory,
          children: item.isDirectory ? [] : undefined,
          isHidden: item.name.startsWith('.')
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
      
      // 刷新选项
      menu.append(new MenuItem({
        label: t('sftp.refresh'),
        click: () => refreshDirectory(nodeData.key)
      }));

      // 文件夹特有选项
      if (!nodeData.isLeaf) {
        menu.append(new MenuItem({
          label: t('sftp.upload'),
          click: () => {
            // 创建隐藏的文件输入元素
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.style.display = 'none';
            document.body.appendChild(input);

            // 监听文件选择
            input.onchange = async (e) => {
              const files = e.target.files;
              if (!files.length) return;

              for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const reader = new FileReader();
                reader.onload = async (e) => {
                  try {
                    const base64Content = e.target.result.split(',')[1];
                    await axios.post('http://localhost:5000/sftp_upload_file', {
                      connection: props.connection,
                      path: nodeData.key === 'root' ? '/' : nodeData.key,
                      filename: file.name,
                      content: base64Content
                    });
                    Message.success(t('sftp.uploadSuccess'));
                    await refreshDirectory(nodeData.key);
                    await logOperation('upload', `${nodeData.key}/${file.name}`);
                  } catch (error) {
                    console.error('Failed to upload file:', error);
                    Message.error(`Failed to upload ${file.name}: ${error.message}`);
                  }
                };
                reader.readAsDataURL(file);
              }
              // 清理临时元素
              document.body.removeChild(input);
            };

            // 触发文件选择
            input.click();
          }
        }));

        menu.append(new MenuItem({
          label: t('sftp.newFolder'),
          click: () => createNewFolder(nodeData)
        }));
      }

      // 文件特有选项
      if (nodeData.isLeaf) {
        menu.append(new MenuItem({
          label: t('sftp.download'),
          click: () => downloadItem(nodeData)
        }));
      }

      // 重命名选项
      menu.append(new MenuItem({
        label: t('sftp.rename'),
        click: () => showRenameModal(nodeData)
      }));

      menu.append(new MenuItem({ type: 'separator' }));

      // 删除选项
      menu.append(new MenuItem({
        label: nodeData.isLeaf ? t('sftp.deleteFile') : t('sftp.deleteFolder'),
        click: () => {
          Modal.warning({
            title: t('sftp.delete'),
            content: t('sftp.confirmDelete', { name: nodeData.title }),
            titleAlign: 'start',
            hideCancel: false,
            okText: t('sftp.delete'),
            cancelText: t('sftp.cancel'),
            okButtonProps: {
              status: 'danger'
            },
            onOk: () => {
              deleteItem(nodeData.key)
            }
          })
        },
        type: 'normal'
      }));

      menu.popup();
    };

    const deleteItem = async (path) => {
      try {
        const response = await axios.post('http://localhost:5000/sftp_delete_item', {
          connection: props.connection,
          path: path
        });

        if (response.data.error) {
          throw new Error(response.data.error);
        }

        Message.success('Item deleted successfully');
        await logOperation('delete', path);
        
        // 刷新当前目录
        const parentPath = path.split('/').slice(0, -1).join('/') || '/';
        await refreshDirectory(parentPath);
      } catch (error) {
        console.error('Failed to delete item:', error);
        Message.error(`Failed to delete item: ${error.message}`);
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

    const refreshDirectory = async (path) => {
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

        // 更新文件树
        const updateNode = (node) => {
          if (node.key === path) {
            node.children = response.data.map(item => ({
              title: item.name,
              key: normalizePath(path + '/' + item.name),
              isLeaf: !item.isDirectory,
              children: item.isDirectory ? [] : undefined
            }));
            return true;
          }
          if (node.children) {
            for (let child of node.children) {
              if (updateNode(child)) {
                return true;
              }
            }
          }
          return false;
        };

        // 如果是根目录
        if (path === '/') {
          fileTree.value = [{
            title: '/',
            key: 'root',
            isLeaf: false,
            children: response.data.map(item => ({
              title: item.name,
              key: normalizePath('/' + item.name),
              isLeaf: !item.isDirectory,
              children: item.isDirectory ? [] : undefined
            }))
          }];
        } else {
          // 更新特定目录
          fileTree.value.forEach(node => updateNode(node));
        }

        Message.success('Directory refreshed');
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
      historyVisible.value = true
      await refreshHistory()
    }

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

    const onItemDoubleClick = async (nodeData) => {
      if (nodeData.isLeaf) {
        try {
          const response = await axios.post('http://localhost:5000/sftp_download_file', {
            connection: props.connection,
            path: nodeData.key
          }, {
            responseType: 'blob'
          });

          const url = window.URL.createObjectURL(new Blob([response.data]));
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', nodeData.title);
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.URL.revokeObjectURL(url);

          Message.success('File downloaded successfully');
          log_sftp_operation('download', nodeData.key);
        } catch (error) {
          console.error('Failed to download file:', error);
          Message.error('Failed to download file');
        }
      } else {
        // 如果是文件夹，展开它
        if (nodeData.children && nodeData.children.length === 0) {
          await refreshDirectory(nodeData.key);
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

    const modalWidth = ref(700)
    const pageSize = ref(10)
    const tableHeight = ref(400)

    const updateModalSize = () => {
      const windowHeight = window.innerHeight
      const windowWidth = window.innerWidth
      
      // 计算模态框宽度（最大700，最小500）
      modalWidth.value = Math.min(Math.max(windowWidth * 0.7, 500), 700)
      
      // 计算表格高度（窗口高度的60%，最小300）
      tableHeight.value = Math.max(windowHeight * 0.6, 300)
      
      // 计算每页显示数量（根据表格高度）
      pageSize.value = Math.max(Math.floor((tableHeight.value - 100) / 40), 5)
    }

    onMounted(() => {
      console.log('SFTPExplorer mounted, connection:', props.connection);
      fetchRootDirectory();
      updateModalSize()
      window.addEventListener('resize', updateModalSize)
    });

    onUnmounted(() => {
      window.removeEventListener('resize', updateModalSize)
    });

    watch(() => props.connection, () => {
      fetchRootDirectory()
    }, { immediate: true })

    const t = (key, params) => {
      return i18n.t(key, params)
    }

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
      deleteItem,
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
      t,
      historyColumns,
      parsedHistory,
      formatTime,
      getOperationColor,
      refreshHistory,
      clearHistory,
      modalWidth,
      pageSize,
      tableHeight
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

.sftp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border);
}

.sftp-actions {
  display: flex;
  gap: 8px;
}

/* 隐藏文件的样式 */
.hidden-file {
  opacity: 0.6;
}

/* 右键菜单中删除选项的样式 */
:deep(.danger-menu-item) {
  color: #f5222d !important;
}

:deep(.danger-menu-item:hover) {
  background-color: #fff1f0 !important;
}

.history-container {
  display: flex;
  flex-direction: column;
  height: 600px;
}

.history-toolbar {
  display: flex;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 8px;
}

.history-content {
  flex: 1;
  overflow-y: auto;
}

:deep(.arco-table-th) {
  background-color: var(--color-fill-2) !important;
}

:deep(.arco-table-tr:hover) {
  background-color: var(--color-fill-2);
}

:deep(.arco-tag) {
  min-width: 80px;
  text-align: center;
}

:deep(.arco-modal-content) {
  padding: 0 20px;
}

.history-modal {
  display: flex;
  flex-direction: column;
}

.history-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.history-toolbar {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 8px;
}

.history-content {
  flex: 1;
  overflow: hidden;
}

:deep(.arco-table-container) {
  height: 100%;
}

:deep(.arco-table-body) {
  overflow-y: auto;
}

:deep(.arco-modal-content) {
  padding: 0 20px;
  height: calc(100% - 100px); /* 减去标题和padding的高度 */
}

:deep(.arco-table-th) {
  background-color: var(--color-fill-2) !important;
}

:deep(.arco-table-tr:hover) {
  background-color: var(--color-fill-2);
}

:deep(.arco-tag) {
  min-width: 80px;
  text-align: center;
}
</style>


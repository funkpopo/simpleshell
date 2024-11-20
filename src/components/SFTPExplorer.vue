<template>
  <div 
    class="sftp-explorer"
    :class="{ 'drag-active': isDragging }"
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent="handleDragOver"
    @dragleave.prevent="handleDragLeave"
    @drop.prevent="handleDrop"
  >
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
            v-model:expandedKeys="expandedKeys"
            @expand="onExpand"
          >
            <template #icon="nodeData">
              <icon-file v-if="nodeData.isLeaf" class="file-icon" />
              <icon-folder v-else class="folder-icon" />
            </template>
            <template #title="nodeData">
              <div
                :class="{
                  'tree-node-content': true,
                  'folder-item': !nodeData.isLeaf,
                  'file-item': nodeData.isLeaf,
                  'hidden-file': nodeData.isHidden,
                  'drag-over': !nodeData.isLeaf && dragTargetKey === nodeData.key
                }"
                @dragenter.prevent="(e) => handleFolderDragEnter(e, nodeData)"
                @dragover.prevent="(e) => handleFolderDragOver(e, nodeData)"
                @dragleave.prevent="(e) => handleFolderDragLeave(e, nodeData)"
                @drop.prevent="(e) => handleFolderDrop(e, nodeData)"
                @contextmenu.prevent.stop="(e) => showContextMenu(e, nodeData)"
                @dblclick.stop="handleNodeDoubleClick(nodeData)"
              >
                <span class="item-title">{{ nodeData.title }}</span>
              </div>
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
            :scroll="{ y: tableHeight, x: '100%' }"
          >
            <template #cell="{ column, record }">
              <template v-if="column.dataIndex === 'time'">
                {{ formatHistoryTime(record.time) }}
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

    <!-- 替换原有的进度条模态框为浮动通知 -->
    <div 
      v-if="downloadProgressVisible" 
      class="download-progress-float"
    >
      <div class="download-progress">
        <div class="progress-info">
          <span class="file-name">{{ downloadInfo.fileName }}</span>
          <span class="progress-percent">{{ downloadInfo.progress }}%</span>
        </div>
        <a-progress
          :percent="downloadInfo.progress"
          :status="downloadInfo.status"
          :show-text="false"
          size="small"
        />
        <div class="progress-details">
          <span>{{ downloadInfo.speed }}</span>
          <span>{{ downloadInfo.timeRemaining }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, watch, inject, onUnmounted, reactive } from 'vue';
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
    const expandedKeys = ref([]);
    const newFolderModalVisible = ref(false);
    const newFolderName = ref('');
    const currentFolderPath = ref('');
    const i18n = inject('i18n');

    const historyColumns = [
      {
        title: 'Time',
        dataIndex: 'time',
        width: 180,
        fixed: 'left'
      },
      {
        title: 'Operation',
        dataIndex: 'operation',
        width: 120,
      },
      {
        title: 'Path',
        dataIndex: 'path',
        ellipsis: true,
        minWidth: 300
      }
    ]

    const parsedHistory = ref([])

    const formatHistoryTime = (timeStr) => {
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
        
        if (response.data.error) {
          throw new Error(response.data.error);
        }

        // 保存当前展开的路径
        const previouslyExpanded = [...expandedKeys.value];
        
        // 更新文件树
        fileTree.value = sortItems(response.data.map(item => ({
          title: item.name,
          key: normalizePath('/' + item.name),
          isLeaf: !item.isDirectory,
          children: item.isDirectory ? [] : undefined,
          isHidden: item.name.startsWith('.')
        })));

        // 重新加载之前展开的目录
        for (const key of previouslyExpanded) {
          const node = findNodeByKey(key);
          if (node && !node.isLeaf) {
            await loadMoreData(node);
          }
        }

        // 恢复展开状态
        expandedKeys.value = previouslyExpanded;
        
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

    const onExpand = async (keys, { expanded, node }) => {
      expandedKeys.value = keys;
      if (expanded && node.children.length === 0) {
        await loadMoreData(node);
      }
    };

    const showContextMenu = (event, nodeData) => {
      event.preventDefault();
      event.stopPropagation();
      const menu = new Menu();
      
      // 刷新选项
      menu.append(new MenuItem({
        label: t('sftp.refresh'),
        click: async () => {
          const refreshPath = nodeData.key === 'root' ? '/' : nodeData.key;
          await refreshDirectory(refreshPath);
        }
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
                await uploadFiles([file], nodeData.key === 'root' ? '/' : nodeData.key);
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

        // 添加文件下载选项
        menu.append(new MenuItem({
          label: t('sftp.downloadFolder'),
          click: () => downloadFolder(nodeData)
        }));
      } else {
        // 文件下载选项
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
        await fetch('http://localhost:5000/sftp_operation_log', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            operation: 'your_operation',
            path: 'your_path'
          })
        });
      } catch (error) {
        console.error('Failed to log SFTP operation:', error);
      }
    };

    const refreshCurrentDirectory = async () => {
      try {
        loading.value = true;
        
        // 获取当前选中的路径
        let pathToRefresh = currentDirectory.value;
        
        // 如果当前路径指向一个文件，获取其父目录
        const currentNode = findNodeByKey(pathToRefresh);
        if (currentNode && currentNode.isLeaf) {
          pathToRefresh = pathToRefresh.substring(0, pathToRefresh.lastIndexOf('/')) || '/';
        }
        
        console.log('Refreshing path:', pathToRefresh);
        
        // 如果是根目录，直接刷新整个文件树
        if (pathToRefresh === '/' || pathToRefresh === 'root') {
          await fetchRootDirectory();
        } else {
          // 获取目录内容
          const response = await axios.post('http://localhost:5000/sftp_list_directory', {
            connection: props.connection,
            path: pathToRefresh
          });

          if (response.data.error) {
            throw new Error(response.data.error);
          }

          // 更新目录内容
          const updateNode = (nodes) => {
            for (let i = 0; i < nodes.length; i++) {
              if (nodes[i].key === pathToRefresh) {
                nodes[i].children = sortItems(response.data.map(item => ({
                  title: item.name,
                  key: normalizePath(`${pathToRefresh}/${item.name}`),
                  isLeaf: !item.isDirectory,
                  children: item.isDirectory ? [] : undefined
                })));
                return true;
              }
              if (nodes[i].children && updateNode(nodes[i].children)) {
                return true;
              }
            }
            return false;
          };

          // 如果找不到节点，刷新整个文件树
          if (!updateNode(fileTree.value)) {
            await fetchRootDirectory();
          }
        }

        Message.success(t('sftp.refreshSuccess'));
      } catch (error) {
        console.error('Failed to refresh directory:', error);
        Message.error(t('sftp.refreshFailed'));
      } finally {
        loading.value = false;
      }
    };

    const refreshDirectory = async (path) => {
      try {
        loading.value = true;
        console.log('Refreshing directory:', path);
        
        // 如果传入的是文件路径，获取其父目录
        let directoryPath = path;
        if (typeof path === 'string') {
          // 如果路径以 '/' 结尾或是根目录，直接使用该路径
          if (path === '/' || path === 'root' || path.endsWith('/')) {
            directoryPath = path === 'root' ? '/' : path;
          } else {
            // 否则获取父目录路径
            directoryPath = path.substring(0, path.lastIndexOf('/')) || '/';
          }
        }
        
        console.log('Actual refresh path:', directoryPath);
        
        const response = await axios.post('http://localhost:5000/sftp_list_directory', {
          connection: props.connection,
          path: directoryPath === 'root' ? '/' : directoryPath
        });

        if (response.data.error) {
          throw new Error(response.data.error);
        }

        // 如果是根目录，直接更新整个文件树
        if (directoryPath === '/' || directoryPath === 'root') {
          fileTree.value = sortItems(response.data.map(item => ({
            title: item.name,
            key: normalizePath('/' + item.name),
            isLeaf: !item.isDirectory,
            children: item.isDirectory ? [] : undefined
          })));
        } else {
          // 更新特定目录
          const updateNode = (nodes) => {
            for (let i = 0; i < nodes.length; i++) {
              if (nodes[i].key === directoryPath) {
                nodes[i].children = sortItems(response.data.map(item => ({
                  title: item.name,
                  key: normalizePath(`${directoryPath}/${item.name}`),
                  isLeaf: !item.isDirectory,
                  children: item.isDirectory ? [] : undefined
                })));
                return true;
              }
              if (nodes[i].children && updateNode(nodes[i].children)) {
                return true;
              }
            }
            return false;
          };
          
          if (!updateNode(fileTree.value)) {
            // 如果没找到节点，尝试刷新整个树
            await fetchRootDirectory();
          }
        }

        Message.success(t('sftp.refreshSuccess'));
      } catch (error) {
        console.error('Failed to refresh directory:', error);
        Message.error(t('sftp.refreshFailed'));
      } finally {
        loading.value = false;
      }
    };

    const findNodeByKey = (key) => {
      const findInNodes = (nodes) => {
        for (const node of nodes) {
          if (node.key === key) return node;
          if (node.children) {
            const result = findInNodes(node.children);
            if (result) return result;
          }
        }
        return null;
      };
      return findInNodes(fileTree.value);
    };

    const findParentNode = (key) => {
      const findInNodes = (nodes) => {
        for (const node of nodes) {
          if (node.children) {
            for (const child of node.children) {
              if (child.key === key) return node;
            }
            const result = findInNodes(node.children);
            if (result) return result;
          }
        }
        return null;
      };
      return findInNodes(fileTree.value);
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
        const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/')) || '/';
        const newPath = normalizePath(`${parentPath}/${newName.value}`);

        await axios.post('http://localhost:5000/sftp_rename_item', {
          connection: props.connection,
          oldPath: oldPath,
          newPath: newPath
        });

        Message.success(t('sftp.renameSuccess'));
        renameModalVisible.value = false;

        // 修改刷新逻辑：直接刷新父目录
        try {
          // 获取父目录的节点
          const parentNode = findNodeByKey(parentPath);
          if (parentNode) {
            // 如果找到父节点，刷新其内容
            await loadMoreData(parentNode);
          } else {
            // 如果找不到父节点（比如在根目录），刷新整个文件树
            await fetchRootDirectory();
          }
        } catch (refreshError) {
          console.error('Directory refresh error:', refreshError);
          // 即使刷新失败也不要显示错误消息，因为重命已经成功了
        }

        await logOperation('rename', `${oldPath} to ${newPath}`);
      } catch (error) {
        console.error('Failed to rename item:', error);
        Message.error(t('sftp.renameFailed'));
      }
    };

    const onItemDoubleClick = async (nodeData) => {
      if (nodeData.isLeaf) {
        try {
          const response = await axios.post('http://localhost:5000/sftp/download', {
            connection: props.connection,
            path: nodeData.key,
            isDirectory: false
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
          await logOperation('download', nodeData.key);
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

        // 使用 Buffer.from 创建缓冲区
        const buffer = Buffer.from(await response.data.arrayBuffer());
        // 使用 fs.writeFileSync 写入文件
        fs.writeFileSync(savePath.filePath, buffer);

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
          title: 'Save file',
          defaultPath: nodeData.title,
          buttonLabel: 'Save'
        });

        if (savePath.canceled) return;

        // 显示进度条
        downloadProgressVisible.value = true;
        downloadInfo.fileName = nodeData.title;
        downloadInfo.progress = 0;
        downloadInfo.status = 'normal';
        downloadInfo.startTime = null;
        downloadInfo.downloadedSize = 0;
        downloadInfo.totalSize = 0;

        const response = await axios.post('http://localhost:5000/sftp_download_file', {
          connection: props.connection,
          path: nodeData.key
        }, {
          responseType: 'blob',
          onDownloadProgress: (progressEvent) => {
            updateDownloadProgress(
              progressEvent.loaded,
              progressEvent.total,
              nodeData.title
            );
          }
        });

        const buffer = Buffer.from(await response.data.arrayBuffer());
        fs.writeFileSync(savePath.filePath, buffer);

        // 完成后更新状态
        downloadInfo.status = 'success';
        downloadInfo.progress = 100;
        
        setTimeout(() => {
          downloadProgressVisible.value = false;
          Message.success(`${nodeData.title} downloaded successfully`);
        }, 500);

        await logOperation('download', nodeData.key);
      } catch (error) {
        downloadInfo.status = 'error';
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

    const downloadFolder = async (nodeData) => {
      try {
        const savePath = await dialog.showOpenDialog({
          title: t('sftp.selectFolderToSave'),
          properties: ['openDirectory', 'createDirectory'],
          buttonLabel: t('sftp.select')
        });

        if (savePath.canceled) return;

        const targetDir = savePath.filePaths[0];
        
        // 显示下载进度
        downloadProgressVisible.value = true;
        downloadInfo.fileName = nodeData.title;
        downloadInfo.progress = 0;
        downloadInfo.status = 'normal';

        // 从服务器下载压缩后的文件夹
        const response = await axios.post('http://localhost:5000/sftp_download_folder', {
          connection: props.connection,
          path: nodeData.key
        }, {
          responseType: 'blob',
          onDownloadProgress: (progressEvent) => {
            updateDownloadProgress(
              progressEvent.loaded,
              progressEvent.total,
              nodeData.title
            );
          }
        });

        // 保存压缩文件到临时目录
        const tempDir = await ipcRenderer.invoke('create-temp-dir');
        const zipPath = path.join(tempDir, `${nodeData.title}.zip`);
        await fs.promises.writeFile(zipPath, Buffer.from(await response.data.arrayBuffer()));

        // 解压文件到目标目录
        await ipcRenderer.invoke('extract-folder', {
          zipPath: zipPath,
          targetPath: path.join(targetDir, nodeData.title)
        });

        // 清理临时文件
        await ipcRenderer.invoke('cleanup-temp-dir', tempDir);

        downloadInfo.status = 'success';
        downloadInfo.progress = 100;
        
        setTimeout(() => {
          downloadProgressVisible.value = false;
          Message.success(t('sftp.downloadSuccess'));
        }, 500);

        await logOperation('download_folder', nodeData.key);
      } catch (error) {
        downloadInfo.status = 'error';
        console.error('Failed to download folder:', error);
        Message.error(t('sftp.downloadFailed'));
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

    // 添加拖拽相关的状态
    const isDragging = ref(false);
    const dragTargetKey = ref(null);
    const dragLeaveTimer = ref(null);

    // 处理整体拖拽事件
    const handleDragEnter = (event) => {
      event.preventDefault();
      isDragging.value = true;
    };

    const handleDragOver = (event) => {
      event.preventDefault();
    };

    const handleDragLeave = (event) => {
      event.preventDefault();
      // 使用定时器避免子元素触发的 dragleave 事件
      if (dragLeaveTimer.value) {
        clearTimeout(dragLeaveTimer.value);
      }
      dragLeaveTimer.value = setTimeout(() => {
        isDragging.value = false;
      }, 100);
    };

    const handleDrop = async (event) => {
      event.preventDefault();
      isDragging.value = false;
      
      try {
        const files = Array.from(event.dataTransfer.files);
        if (files.length === 0) {
          return;
        }
        
        console.log('Dropping files to root:', files.map(f => f.name));
        await uploadFiles(files, '/');
      } catch (error) {
        console.error('Drop handling failed:', error);
        Message.error(t('sftp.uploadFailed'));
      }
    };

    // 处理文件夹的拖拽事件
    const handleFolderDragEnter = (event, nodeData) => {
      event.preventDefault();
      event.stopPropagation();
      if (!nodeData.isLeaf) {
        dragTargetKey.value = nodeData.key;
      }
    };

    const handleFolderDragOver = (event, nodeData) => {
      event.preventDefault();
      event.stopPropagation();
      if (!nodeData.isLeaf) {
        dragTargetKey.value = nodeData.key;
      }
    };

    const handleFolderDragLeave = (event, nodeData) => {
      event.preventDefault();
      event.stopPropagation();
      // 检查是否真的离开了节点区域
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX;
      const y = event.clientY;
      
      if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
        if (dragTargetKey.value === nodeData.key) {
          dragTargetKey.value = null;
        }
      }
    };

    const handleFolderDrop = async (event, nodeData) => {
      event.preventDefault();
      event.stopPropagation();
      isDragging.value = false;
      dragTargetKey.value = null;

      if (nodeData.isLeaf) return;

      try {
        const files = Array.from(event.dataTransfer.files);
        if (files.length === 0) {
          return;
        }
        
        console.log('Dropping files to folder:', nodeData.key, files.map(f => f.name));
        await uploadFiles(files, nodeData.key);
      } catch (error) {
        console.error('Folder drop handling failed:', error);
        Message.error(t('sftp.uploadFailed'));
      }
    };

    // 修改 uploadFiles 函数
    const uploadFiles = async (files, targetPath) => {
      const loadingMessage = Message.loading({
        content: t('sftp.uploadingFiles'),
        duration: 0
      });

      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          
          // 检查是否是文件夹
          if (file.webkitRelativePath || file.isDirectory) {
            console.log('Uploading folder:', file.name);
            await uploadFolder(file, targetPath);
          } else {
            console.log('Uploading file:', file.name);
            await uploadSingleFile(file, targetPath);
          }
        }

        loadingMessage.close();
        Message.success(t('sftp.uploadSuccess'));
        await refreshDirectoryKeepingState(targetPath);
      } catch (error) {
        loadingMessage.close();
        console.error('Upload failed:', error);
        Message.error(error.message || t('sftp.uploadFailed'));
      }
    };

    // 添加文件夹上传函数
    const uploadFolder = async (folder, targetPath) => {
      try {
        // 创建临时目录用于存储要压缩的文件
        const tempDir = await ipcRenderer.invoke('create-temp-dir');
        
        // 递归读取文件夹内容并保持目录结构
        const processDirectory = async (entry, basePath) => {
          const reader = entry.createReader();
          const entries = await new Promise((resolve) => {
            reader.readEntries(resolve);
          });
          
          for (const entry of entries) {
            if (entry.isDirectory) {
              await processDirectory(entry, path.join(basePath, entry.name));
            } else {
              const file = await new Promise((resolve) => {
                entry.file(resolve);
              });
              const filePath = path.join(basePath, file.name);
              await fs.promises.writeFile(
                path.join(tempDir, filePath),
                await file.arrayBuffer()
              );
            }
          }
        };

        await processDirectory(folder.webkitGetAsEntry(), '');

        // 压缩文件夹
        const zipPath = path.join(tempDir, `${folder.name}.zip`);
        await ipcRenderer.invoke('compress-folder', {
          sourcePath: tempDir,
          targetPath: zipPath
        });

        // 上传压缩文件
        const zipContent = await fs.promises.readFile(zipPath, { encoding: 'base64' });
        
        // 发送到服务器并在服务器端解压
        await axios.post('http://localhost:5000/sftp_upload_folder', {
          connection: props.connection,
          path: targetPath,
          folderName: folder.name,
          content: zipContent
        });

        // 清理临时文件
        await ipcRenderer.invoke('cleanup-temp-dir', tempDir);
      } catch (error) {
        throw new Error(`Failed to upload folder: ${error.message}`);
      }
    };

    // 添加双击处理函数
    const handleNodeDoubleClick = async (nodeData) => {
      if (nodeData.isLeaf) {
        // 如果是文件，执行原来的双击操作（下载）
        await onItemDoubleClick(nodeData);
      } else {
        // 如果是文件夹，切换展开状态
        const index = expandedKeys.value.indexOf(nodeData.key);
        if (index === -1) {
          // 展开文件夹
          expandedKeys.value = [...expandedKeys.value, nodeData.key];
          // 如果子节点还没有加载，加载子节点
          if (!nodeData.children || nodeData.children.length === 0) {
            await loadMoreData(nodeData);
          }
        } else {
          // 收起文件夹
          expandedKeys.value = expandedKeys.value.filter(key => key !== nodeData.key);
        }
      }
    };

    //  setup 中添加进度相关的状态
    const downloadProgressVisible = ref(false);
    const downloadInfo = reactive({
      fileName: '',
      progress: 0,
      status: 'normal',
      speed: '',
      timeRemaining: '',
      startTime: null,
      totalSize: 0,
      downloadedSize: 0
    });

    // 添加下载进度处理函数
    const updateDownloadProgress = (loaded, total, fileName) => {
      if (!downloadInfo.startTime) {
        downloadInfo.startTime = Date.now();
      }

      downloadInfo.fileName = fileName;
      downloadInfo.downloadedSize = loaded;
      downloadInfo.totalSize = total;
      downloadInfo.progress = Math.round((loaded / total) * 100);

      // 计算下载速度
      const elapsedTime = (Date.now() - downloadInfo.startTime) / 1000;
      const speed = loaded / elapsedTime;
      downloadInfo.speed = formatSpeed(speed);

      // 计算剩余时间
      const remaining = (total - loaded) / speed;
      downloadInfo.timeRemaining = formatTime(remaining);
    };

    // 格式化速度显示
    const formatSpeed = (bytesPerSecond) => {
      if (bytesPerSecond >= 1024 * 1024) {
        return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
      } else if (bytesPerSecond >= 1024) {
        return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
      }
      return `${Math.round(bytesPerSecond)} B/s`;
    };

    // 格式化时间显示
    const formatTime = (seconds) => {
      if (seconds < 60) {
        return t('sftp.remainingSeconds', { seconds: Math.round(seconds) });
      } else if (seconds < 3600) {
        const minutes = Math.round(seconds / 60);
        return t('sftp.remainingMinutes', { minutes });
      }
      const hours = Math.round(seconds / 3600);
      return t('sftp.remainingHours', { hours });
    };

    // 在 setup 函数中添加 uploadSingleFile 函数
    const uploadSingleFile = async (file, targetPath) => {
      try {
        const reader = new FileReader();
        const fileContent = await new Promise((resolve, reject) => {
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = (e) => reject(e);
          reader.readAsDataURL(file);
        });

        const base64Content = fileContent.split(',')[1];
        await axios.post('http://localhost:5000/sftp_upload_file', {
          connection: props.connection,
          path: targetPath,
          filename: file.name,
          content: base64Content
        });

        await logOperation('upload', `${targetPath}/${file.name}`);
      } catch (error) {
        console.error('Failed to upload file:', error);
        throw new Error(`Failed to upload ${file.name}: ${error.message}`);
      }
    };

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
      formatHistoryTime,
      getOperationColor,
      refreshHistory,
      clearHistory,
      modalWidth,
      pageSize,
      tableHeight,
      isDragging,
      dragTargetKey,
      handleDragEnter,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      handleFolderDragEnter,
      handleFolderDragOver,
      handleFolderDragLeave,
      handleFolderDrop,
      handleNodeDoubleClick,
      downloadProgressVisible,
      downloadInfo,
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
  position: relative;
  z-index: 9999;
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
  position: relative;
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
  overflow-y: auto !important;
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

/* 添加拽相关样式 */
.drag-over {
  background-color: var(--color-primary-light-1) !important;
  border: 2px dashed var(--color-primary) !important;
}

.folder-drop-target {
  cursor: pointer;
  padding: 2px 4px;
  border: 2px solid transparent;
  border-radius: 4px;
  transition: all 0.2s ease;
  position: relative;
  z-index: 1;
}

.folder-drop-target.drag-over {
  background-color: var(--color-primary-light-1);
  border: 2px dashed var(--color-primary);
}

/* 添加全局拖拽提示样式 */
.sftp-explorer.drag-active {
  position: relative;
}

.sftp-explorer.drag-active::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(var(--primary-1), 0.1);
  border: 2px dashed var(--color-primary);
  pointer-events: none;
  z-index: 9998;
}

/* 确保拖拽样式不会影响右键菜单的显示 */
:deep(.arco-tree-node) {
  position: relative;
  z-index: 10000;
  pointer-events: all;
}

/* 拖拽提示层应该影响交互 */
.sftp-explorer.drag-active::after {
  z-index: 0;
}

/* 修改和添加以下样式 */
:deep(.arco-tree-node) {
  padding: 0;
  margin: 1px 0;
  transition: all 0.2s ease;
  border-radius: 4px;
}

:deep(.arco-tree-node:hover) {
  background-color: var(--color-fill-2);
}

/* 移除其他元素的悬停效果，只保留树节点的悬停效果 */
:deep(.arco-tree-node-title:hover),
:deep(.arco-tree-node-title-text:hover),
.tree-node-content:hover {
  background-color: transparent;
}

/* 修改树节点标题样式 */
:deep(.arco-tree-node-title) {
  width: 100%;
  padding: 0;
  min-height: 24px;
  display: flex;
  align-items: center;
}

:deep(.arco-tree-node-title-text) {
  flex: 1;
  padding: 0;
  margin: 0;
  display: flex;
  align-items: center;
}

/* 修改内容区域样式 */
.tree-node-content {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  width: 100%;
  min-height: 24px;
  transition: all 0.2s ease;
  cursor: pointer;
  border: 2px solid transparent;
}

/* 选中状态样式调整 */
:deep(.arco-tree-node-selected) {
  background-color: var(--color-primary-light-1);
}

:deep(.arco-tree-node-selected) .tree-node-content {
  background-color: transparent;
}

/* 文件夹和文件项样式调整 */
.folder-item,
.file-item {
  width: 100%;
  display: flex;
  align-items: center;
  transition: all 0.2s ease;
}

/* 拖拽状态样式调整 */
:deep(.arco-tree-node) .folder-item.drag-over {
  background-color: transparent;
}

:deep(.arco-tree-node.drag-over) {
  background-color: var(--color-primary-light-1);
  border: 2px dashed var(--color-primary);
  box-shadow: 0 0 0 2px rgba(var(--primary-6), 0.1);
}

/* 确保深色模式下的样式一致性 */
:deep([arco-theme='dark'] .arco-tree-node:hover) {
  background-color: var(--color-fill-3);
}

/* 添加进度条相关样式 */
.download-progress-float {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 300px;
  background-color: var(--color-bg-2);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  padding: 12px;
  z-index: 10000;
  animation: slide-in 0.3s ease;
}

@keyframes slide-in {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.download-progress {
  width: 100%;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.file-name {
  font-size: 13px;
  color: var(--color-text-1);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 8px;
}

.progress-percent {
  font-size: 13px;
  color: var(--color-text-2);
  flex-shrink: 0;
}

:deep(.arco-progress) {
  margin: 4px 0;
}

.progress-details {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-3);
}

/* 深色模式适配 */
:deep([arco-theme='dark']) .download-progress-float {
  background-color: var(--color-bg-3);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}
</style>


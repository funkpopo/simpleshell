<template>
  <div class="sftp-explorer-container">
    <div class="sftp-explorer">
      <div 
        class="sftp-explorer"
        :style="{ width: '100%' }"
        :class="{ 'drag-active': isDragging }"
        @dragenter.prevent="handleDragEnter"
        @dragover.prevent="handleDragOver"
        @dragleave.prevent="handleDragLeave"
        @drop.prevent="handleDrop"
      >
        <div class="sftp-header">
          <div class="sftp-actions">
            <a-button-group>
              <a-button type="primary" @click="deleteMultipleFiles" status="danger">
                <template #icon><icon-delete /></template>
                {{ t('sftp.delete') }}
              </a-button>
            </a-button-group>
            <a-button-group>
              <a-button type="primary" @click="refreshCurrentDirectory">
                <template #icon><icon-refresh /></template>
                {{ t('sftp.refresh') }}
              </a-button>
              <a-button type="primary" @click="showHistory">
                <template #icon><icon-history /></template>
                {{ t('sftp.history') }}
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
                :checkable="true"
                :multiple="true"
                v-model:checkedKeys="selectedFiles"
                @check="onMultiSelect"
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
                    <span class="item-details">
                      <span class="item-mod-time">{{ formatModTime(nodeData.modTime) }}</span>
                      <span class="item-size">{{ formatSize(nodeData.size) }}</span>
                    </span>
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
        <a-modal 
          v-model:visible="fileContentVisible" 
          title="File Content"
          :width="750"
          class="file-preview-modal"
        >
          <pre class="file-preview-content">{{ fileContent }}</pre>
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

        <!-- 修改下载进度浮动通知 -->
        <div v-if="downloadProgressVisible" class="download-progress-float">
          <div class="download-progress">
            <div class="progress-header">
              <span class="file-name">{{ downloadInfo.fileName }}</span>
              <a-button
                class="close-button"
                type="text"
                size="mini"
                @click="cancelDownload"
              >
                <template #icon><icon-close /></template>
              </a-button>
            </div>
            <div class="progress-bar-wrapper">
              <a-progress
                :percent="Number(downloadInfo.progress)"
                :status="downloadInfo.status"
                :show-text="false"
                size="small"
                :stroke-width="4"
              />
            </div>
            <div class="progress-details">
              <span>{{ downloadInfo.speed }}</span>
              <span>{{ downloadInfo.timeRemaining }}</span>
              <span>{{ downloadInfo.transferred }} / {{ downloadInfo.total }}</span>
            </div>
          </div>
        </div>

        <!-- 添加上传进度浮动通知 -->
        <div 
          v-if="uploadProgressVisible" 
          class="upload-progress-float"
        >
          <div class="upload-progress">
            <div class="progress-header">
              <span class="file-name">{{ uploadInfo.fileName }}</span>
              <a-button
                class="close-button"
                type="text"
                size="mini"
                @click="cancelUpload"
              >
                <template #icon><icon-close /></template>
              </a-button>
            </div>
            <div class="progress-bar-wrapper">
              <a-progress
                :percent="Number(uploadInfo.progress)"
                :status="uploadInfo.status"
                :show-text="false"
                size="small"
                :stroke-width="4"
              />
            </div>
            <div class="progress-details">
              <span>{{ uploadInfo.speed }}</span>
              <span>{{ uploadInfo.timeRemaining }}</span>
              <span>{{ uploadInfo.transferred }} / {{ uploadInfo.total }}</span>
            </div>
          </div>
        </div>

        <!-- 添加多选操作的上下文菜单 -->
        <a-dropdown 
          v-if="selectedFiles.length > 0" 
          :popup-container="null"
          trigger="contextmenu"
        >
          <template #content>
            <a-doption @click="downloadMultipleFiles">
              <template #icon><icon-download /></template>
              {{ t('sftp.downloadSelected', { count: selectedFiles.length }) }}
            </a-doption>
            <a-doption @click="deleteMultipleFiles">
              <template #icon><icon-delete /></template>
              {{ t('sftp.deleteSelected', { count: selectedFiles.length }) }}
            </a-doption>
          </template>
        </a-dropdown>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, watch, inject, onUnmounted, reactive, nextTick } from 'vue';
import { IconFile, IconFolder, IconRefresh, IconHome, IconDelete, IconHistory, IconClose } from '@arco-design/web-vue/es/icon';
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
    IconHome,
    IconDelete,
    IconHistory,
    IconClose
  },
  props: {
    connection: {
      type: Object,
      required: true
    }
  },
  setup(props, { emit }) {
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
          isHidden: item.name.startsWith('.'),
          // 添加 modTime 和 size 属性
          modTime: item.modTime,
          size: item.size
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
        
        // 保留已展开的子节点
        const oldExpandedChildren = node.children ? 
          node.children.filter(child => expandedKeys.value.includes(child.key)) : 
          [];

        node.children = sortItems(response.data.map(item => {
          const existingChild = oldExpandedChildren.find(
            oldChild => oldChild.title === item.name
          );
          
          return {
            title: item.name,
            key: normalizePath(path + '/' + item.name),
            isLeaf: !item.isDirectory,
            children: item.isDirectory ? (existingChild ? existingChild.children : []) : undefined,
            expanded: existingChild ? true : false,
            // 添加 modTime 和 size 属性
            modTime: item.modTime,
            size: item.size,
            isHidden: item.isHidden
          };
        }));
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

    const onSelect = async (selectedKeys, { selectedNodes }) => {
      if (selectedNodes.length > 0) {
        const node = selectedNodes[0];
        currentDirectory.value = normalizePath(node.key === 'root' ? '/' : node.key);
        
        if (!node.isLeaf) {
          await loadMoreData(node);
        } else {
          // 对于文件，确保 modTime 和 size 属性存在
          if (!node.modTime || node.modTime === 0) {
            try {
              // 如果 modTime 或 size 不存在，重新获取文件信息
              const response = await axios.post('http://localhost:5000/sftp_list_directory', {
                connection: props.connection,
                path: currentDirectory.value
              });

              const fileInfo = response.data.find(item => 
                normalizePath(currentDirectory.value) === normalizePath(item.path)
              );

              if (fileInfo) {
                // 更新节点的 modTime 和 size
                node.modTime = fileInfo.modTime || 0;
                node.size = fileInfo.size || 0;
              }
            } catch (error) {
              console.error('Failed to refresh file info:', error);
              // 设置默认值
              node.modTime = 0;
              node.size = 0;
            }
          }
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

          // 处理文件过大的情况
          if (response.data.type === 'large') {
            Modal.warning({
              title: t('sftp.filePreviewLimit'),
              content: t('sftp.filePreviewLimitMessage', { 
                fileName: data.title, 
                fileSize: (response.data.size / 1024).toFixed(2) 
              }),
              okText: t('sftp.download'),
              cancelText: t('sftp.cancel'),
              onOk: () => {
                downloadItem(data);
              }
            });
            return;
          }

          // 处理不同类型的文件
          if (response.data.type === 'image') {
            // 图片预览
            fileContent.value = `data:image/${response.data.extension};base64,${response.data.content}`;
            fileContentVisible.value = true;
          } else if (response.data.type === 'text') {
            // 文本预览，使用自定义字体
            const arialFontPath = path.join(__dirname, '../utils/arial.ttf');
            
            // 检查字体文件是否存在
            if (fs.existsSync(arialFontPath)) {
              // 如果字体文件存在，应用自定义字体样式
              fileContent.value = response.data.content;
              nextTick(() => {
                const preElement = document.querySelector('.file-preview-content');
                if (preElement) {
                  preElement.style.fontFamily = 'Arial, sans-serif';
                }
              });
            } else {
              // 如果字体文件不存在，使用默认字体
              fileContent.value = response.data.content;
            }
            
            fileContentVisible.value = true;
          } else {
            // 不支持的文件类型
            Modal.warning({
              title: t('sftp.unsupportedFileType'),
              content: t('sftp.unsupportedFileTypeMessage', { fileName: data.title }),
              okText: t('sftp.download'),
              cancelText: t('sftp.cancel'),
              onOk: () => {
                downloadItem(data);
              }
            });
          }

          await logOperation('read', normalizePath(data.key));
        } catch (error) {
          console.error('Failed to read file:', error);
          Message.error(t('sftp.filePreviewFailed'));
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
            // 保留原有的展开状态
            const oldExpandedChildren = node.children.filter(child => 
              expandedKeys.value.includes(child.key)
            );

            // 合并新的子节点，保留已展开节点的子节点
            node.children = sortItems(newChildren.map(newChild => {
              const existingChild = oldExpandedChildren.find(
                oldChild => oldChild.title === newChild.title
              );
              
              if (existingChild) {
                // 如果是已展开的节点，保留其子节点和展开状态
                return {
                  ...newChild,
                  children: existingChild.children,
                  expanded: true
                };
              }
              
              return newChild;
            }));

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
      // 如果是展开作，且子节点为空则加载子节点
      if (expanded && node.children.length === 0) {
        await loadMoreData(node);
      }

      // 更新展开的 keys
      expandedKeys.value = keys;
    };

    const showContextMenu = (event, nodeData) => {
      event.preventDefault();
      event.stopPropagation();
      const menu = new Menu();
      
      // 添加复制时间的菜单项
      menu.append(new MenuItem({
        label: t('sftp.copyModTime'),
        click: () => {
          const formattedTime = formatModTime(nodeData.modTime);
          const { clipboard } = require('@electron/remote');
          clipboard.writeText(formattedTime);
          
          Message.success(t('sftp.timeCopied', { time: formattedTime }));
        }
      }));

      // 添加复制文件���小的菜单项
      menu.append(new MenuItem({
        label: t('sftp.copySize'),
        click: () => {
          const formattedSize = formatSize(nodeData.size);
          const { clipboard } = require('@electron/remote');
          clipboard.writeText(formattedSize);
          
          Message.success(t('sftp.sizeCopied', { size: formattedSize }));
        }
      }));
      
      // 添加复制路径的菜单项
      menu.append(new MenuItem({
        label: t('sftp.copyPath'),
        click: () => {
          // 获取完整路径
          const fullPath = nodeData.key;
          
          // 使用 Electron 的剪贴板 API 复制路径
          const { clipboard } = require('@electron/remote');
          clipboard.writeText(fullPath);
          
          // ��示复制成功的消息
          Message.success(t('sftp.pathCopied', { path: fullPath }));
        }
      }));

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

          // 更新目录内容，确保更新文件的详细信息
          const updateNode = (nodes) => {
            for (let i = 0; i < nodes.length; i++) {
              if (nodes[i].key === pathToRefresh) {
                nodes[i].children = sortItems(response.data.map(item => {
                  // 查找原有节点，保留子节点和展开状���
                  const existingNode = nodes[i].children 
                    ? nodes[i].children.find(child => child.title === item.name)
                    : null;

                  return {
                    title: item.name,
                    key: normalizePath(`${pathToRefresh}/${item.name}`),
                    isLeaf: !item.isDirectory,
                    children: item.isDirectory ? (existingNode ? existingNode.children : []) : undefined,
                    expanded: existingNode ? existingNode.expanded : false,
                    // 更新 modTime 和 size，确保总是使用最新的值
                    modTime: item.modTime || 0,
                    size: item.size || 0,
                    isHidden: item.isHidden
                  };
                }));
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
            children: item.isDirectory ? [] : undefined,
            // 确保更新 modTime 和 size
            modTime: item.modTime || 0,
            size: item.size || 0
          })));
        } else {
          // 更新特定目录
          const updateNode = (nodes) => {
            for (let i = 0; i < nodes.length; i++) {
              if (nodes[i].key === directoryPath) {
                nodes[i].children = sortItems(response.data.map(item => {
                  // 查找原有节点，保留子节点和展开状态
                  const existingNode = nodes[i].children 
                    ? nodes[i].children.find(child => child.title === item.name)
                    : null;

                  return {
                    title: item.name,
                    key: normalizePath(`${directoryPath}/${item.name}`),
                    isLeaf: !item.isDirectory,
                    children: item.isDirectory ? (existingNode ? existingNode.children : []) : undefined,
                    expanded: existingNode ? existingNode.expanded : false,
                    // 更新 modTime 和 size，确保总是使用最新的值
                    modTime: item.modTime || 0,
                    size: item.size || 0,
                    isHidden: item.isHidden
                  };
                }));
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
          // 即使���新失败也不要显示错误消息，因重命已经成功了
        }

        await logOperation('rename', `${oldPath} to ${newPath}`);
      } catch (error) {
        console.error('Failed to rename item:', error);
        Message.error(t('sftp.renameFailed'));
      }
    };

    const onItemDoubleClick = async (nodeData) => {
      if (nodeData.isLeaf) {
        // 对于文件，执行预览
        await onItemClick(nodeData);
      } else {
        // 对于文件夹，切换展开状态
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

        // 生成传输 ID
        const transferId = `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        downloadInfo.transferId = transferId;
        downloadInfo.fileName = nodeData.title;
        downloadInfo.progress = 0;
        downloadInfo.status = 'normal';
        downloadInfo.startTime = null;
        downloadInfo.totalSize = 0;
        downloadInfo.currentSize = 0;
        downloadProgressVisible.value = true;

        const progressTimer = setInterval(async () => {
          try {
            const response = await axios.get(`http://localhost:5000/transfer_progress/${transferId}`);
            if (response.data) {
              if (response.data.status === 'cancelled') {
                clearInterval(progressTimer);
                downloadProgressVisible.value = false;
                return;
              }

              // 使用服务器返回的进度信息更新UI
              const progress = response.data.progress;
              downloadInfo.progress = progress;
              downloadInfo.speed = response.data.speed;
              downloadInfo.timeRemaining = response.data.estimated_time;
              downloadInfo.transferred = response.data.transferred;
              downloadInfo.total = response.data.total;
              downloadInfo.status = response.data.status;

              // 更新进度条
              updateProgressBar('download', progress);
            }
          } catch (error) {
            console.error('Failed to get download progress:', error);
          }
        }, 1000);

        try {
          const response = await axios.post('http://localhost:5000/sftp_download_file', {
            connection: props.connection,
            path: nodeData.key,
            transferId: transferId
          }, {
            responseType: 'blob',
            onDownloadProgress: (progressEvent) => {
              // 使用 progressEvent 的 loaded 和 total 属性更新进度
              if (progressEvent.total) {
                updateDownloadProgress(
                  progressEvent.loaded,
                  progressEvent.total,
                  nodeData.title
                );
              }
            }
          });

          const buffer = Buffer.from(await response.data.arrayBuffer());
          fs.writeFileSync(savePath.filePath, buffer);

          downloadInfo.status = 'success';
          downloadInfo.progress = 100;
          updateProgressBar('download', 100);
          
          setTimeout(() => {
            downloadProgressVisible.value = false;
            Message.success(`${nodeData.title} downloaded successfully`);
          }, 500);

          await logOperation('download', nodeData.key);

        } finally {
          clearInterval(progressTimer);
        }

      } catch (error) {
        downloadInfo.status = 'error';
        console.error('Failed to download item:', error);
        Message.error(`Failed to download ${nodeData.title}: ${error.message}`);
      } finally {
        if (downloadInfo.status !== 'cancelled') {
          setTimeout(() => {
            downloadProgressVisible.value = false;
          }, 1000);
        }
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
      } finally {
        // 如果不是因为取消而结束，才自动隐藏进度条
        if (downloadInfo.status !== 'cancelled') {
          setTimeout(() => {
            downloadProgressVisible.value = false;
          }, 1000);
        }
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
      
      // 计算每页显示数量（根据表格高）
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
      event.preventDefault()
      event.stopPropagation()
      
      // 检查是否是文件拖拽
      if (event.dataTransfer.types.includes('Files')) {
        isDragging.value = true
      }
    }

    const handleDragOver = (event) => {
      event.preventDefault()
      event.stopPropagation()
      
      // 设置拖拽效果为复制
      event.dataTransfer.dropEffect = 'copy'
    }

    const handleDragLeave = (event) => {
      event.preventDefault()
      event.stopPropagation()
      
      // 检查鼠标是否离开了拖拽区域
      const rect = event.currentTarget.getBoundingClientRect()
      if (
        event.clientX < rect.left || 
        event.clientX >= rect.right || 
        event.clientY < rect.top || 
        event.clientY >= rect.bottom
      ) {
        isDragging.value = false
      }
    }

    const handleDrop = async (event) => {
      event.preventDefault()
      event.stopPropagation()

      // 检查是否有文件
      const files = event.dataTransfer.files
      if (files.length === 0) return

      // 获取目标节点
      const targetNode = findDropTargetNode(event)
      if (!targetNode || targetNode.isLeaf) {
        Message.error(this.$t('sftp.dropOnFolder'))
        return
      }

      try {
        // 遍历并上传文件
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          
          // 使用 FileReader 读取文件内容
          const reader = new FileReader()
          reader.onload = async (e) => {
            try {
              // 获取 Base64 编码的文件内容
              const base64Content = e.target.result.split(',')[1]
              
              // 上传文件
              await axios.post('http://localhost:5000/sftp_upload_file', {
                connection: props.connection,
                path: normalizePath(targetNode.key === 'root' ? '/' : targetNode.key),
                filename: file.name,
                content: base64Content
              })
              
              Message.success(`Uploaded ${file.name} successfully`)
              
              // 刷新目标目录
              await loadMoreData(targetNode)
            } catch (error) {
              console.error('Failed to upload file:', error)
              Message.error(`Failed to upload ${file.name}`)
            }
          }
          
          // 读取文件内容
          reader.readAsDataURL(file)
        }
      } catch (error) {
        console.error('Error in file drop:', error)
        Message.error('Failed to upload files')
      }
    }

    // 添加一个辅助函数来找到放置目标节点
    const findDropTargetNode = (event) => {
      // 遍历树节点，找到最近的文件夹节点
      const findNearestFolder = (nodes) => {
        for (const node of nodes) {
          const element = document.elementFromPoint(event.clientX, event.clientY)
          if (element && element.closest(`[data-key="${node.key}"]`)) {
            return !node.isLeaf ? node : null
          }
          
          if (node.children) {
            const childResult = findNearestFolder(node.children)
            if (childResult) return childResult
          }
        }
        return null
      }

      return findNearestFolder(fileTree.value)
    }

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
      // 查是否真的离开了节点区域
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
      let loadingMessage = null;
      let successCount = 0;
      let failCount = 0;

      try {
        loadingMessage = Message.loading({
          content: t('sftp.uploadingFiles'),
          duration: 0
        });

        uploadProgressVisible.value = true;
        uploadInfo.status = 'normal';
        uploadInfo.progress = 0;
        uploadInfo.startTime = null;

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          
          try {
            // 检查是否是文件夹
            if (file.webkitRelativePath || file.isDirectory) {
              console.log('Uploading folder:', file.name);
              await uploadFolder(file, targetPath);
              successCount++;
            } else {
              console.log('Uploading file:', file.name);
              await uploadSingleFile(file, targetPath);
              successCount++;
            }
          } catch (error) {
            if (error.message === 'Transfer cancelled') {
              // 如果是取消操作，停止后续文件的上传
              break;
            }
            // 其他错误继续上传下一个文件
            console.error(`Error uploading ${file.name}:`, error);
            failCount++;
          }
        }

        // 刷新目录
        await refreshDirectoryKeepingState(targetPath);

        // 显示最终结果
        if (successCount > 0 || failCount > 0) {
          if (failCount === 0) {
            Message.success(t('sftp.uploadSuccess'));
          } else if (successCount === 0) {
            Message.error(t('sftp.uploadFailed'));
          } else {
            Message.warning(t('sftp.uploadPartialSuccess', {
              success: successCount,
              fail: failCount
            }));
          }
        }

      } catch (error) {
        console.error('Upload failed:', error);
        uploadInfo.status = 'error';
        if (error.message !== 'Transfer cancelled') {
          Message.error(t('sftp.uploadFailed'));
        }
      } finally {
        if (loadingMessage) {
          loadingMessage.close();
        }
      }
    };

    // 添加文件夹上传函数
    const uploadFolder = async (folder, targetPath) => {
      try {
        uploadProgressVisible.value = true;
        uploadInfo.fileName = folder.name;
        uploadInfo.status = 'normal';
        uploadInfo.progress = 0;
        uploadInfo.startTime = null;

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

        // 上���压缩文件
        const zipContent = await fs.promises.readFile(zipPath, { encoding: 'base64' });
        
        // 发送到服务器并在务器端解压
        await axios.post('http://localhost:5000/sftp_upload_folder', {
          connection: props.connection,
          path: targetPath,
          folderName: folder.name,
          content: zipContent
        });

        // 清理临时文
        await ipcRenderer.invoke('cleanup-temp-dir', tempDir);
      } catch (error) {
        uploadInfo.status = 'error';
        throw new Error(`Failed to upload folder: ${error.message}`);
      }
    };

    // 添加双击处理函数
    const handleNodeDoubleClick = async (nodeData) => {
      if (nodeData.isLeaf) {
        // 对于文件，执行预览
        await onItemClick(nodeData);
      } else {
        // 对于文件夹，切换展开状态
        const index = expandedKeys.value.indexOf(nodeData.key);
        if (index === -1) {
          // 展开文件夹
          expandedKeys.value = [...expandedKeys.value, nodeData.key];
          // ���果子节点还没有加载，加载子节点
          if (!nodeData.children || nodeData.children.length === 0) {
            await loadMoreData(nodeData);
          }
        } else {
          // 收起文件夹
          expandedKeys.value = expandedKeys.value.filter(key => key !== nodeData.key);
        }
      }
    };

    //  setup 中添加度相关的状态
    const downloadProgressVisible = ref(false);
    const downloadInfo = reactive({
      fileName: '',
      progress: 0,
      status: 'normal',
      speed: '',
      timeRemaining: '',
      transferred: '',
      total: '',
      transferId: null,
      startTime: null,
      totalSize: 0,    // 添加总大小字段
      currentSize: 0   // 添加当前下载大小字段
    });

    // 修改下载进度更新函数
    const updateDownloadProgress = (loaded, total, fileName) => {
      if (!downloadInfo.startTime) {
        downloadInfo.startTime = Date.now();
        downloadInfo.totalSize = total;
      }

      downloadInfo.fileName = fileName;
      downloadInfo.currentSize = loaded;
      downloadInfo.transferred = formatSize(loaded);
      downloadInfo.total = formatSize(total);

      // 使用实际的字节数计算进度
      const progress = total > 0 ? Math.round((loaded / total) * 100) : 0;
      downloadInfo.progress = progress;

      // 更新进度条
      updateProgressBar('download', progress);

      // 计算下载速度
      const elapsedTime = (Date.now() - downloadInfo.startTime) / 1000;
      const speed = loaded / elapsedTime;
      downloadInfo.speed = formatSpeed(speed);

      // 计算剩余时间
      const remaining = speed > 0 ? (total - loaded) / speed : 0;
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

    // 修改 uploadSingleFile 函数
    const uploadSingleFile = async (file, targetPath) => {
      let loadingMessage = null;
      
      try {
        // 生成传输 ID
        const transferId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        uploadInfo.transferId = transferId;

        // 显示上传进度
        uploadProgressVisible.value = true;
        uploadInfo.fileName = file.name;
        uploadInfo.status = 'normal';
        uploadInfo.progress = 0;
        uploadInfo.speed = '';
        uploadInfo.timeRemaining = '';
        uploadInfo.transferred = '0 B';
        uploadInfo.total = formatSize(file.size);

        // 分块大小设置为 5MB
        const chunkSize = 5 * 1024 * 1024;
        const totalChunks = Math.ceil(file.size / chunkSize);
        let tempFileId = null;
        let isCancelled = false;

        // 修改上传进度更新的逻辑
        const progressTimer = setInterval(async () => {
          try {
            const response = await axios.get(`http://localhost:5000/transfer_progress/${transferId}`);
            if (response.data) {
              // 检查传输状态
              if (response.data.status === 'cancelled') {
                isCancelled = true;
                clearInterval(progressTimer);
                uploadProgressVisible.value = false;
                return;
              }

              uploadInfo.progress = response.data.progress;
              uploadInfo.speed = response.data.speed;
              uploadInfo.timeRemaining = response.data.estimated_time;
              uploadInfo.transferred = response.data.transferred;
              uploadInfo.total = response.data.total;
              uploadInfo.status = response.data.status;

              // 更新进度条
              updateProgressBar('upload', uploadInfo.progress);
            }
          } catch (error) {
            console.error('Failed to get upload progress:', error);
          }
        }, 1000);

        try {
          for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const chunk = file.slice(start, end);
            const isLastChunk = i === totalChunks - 1;

            // 读取块数据
            const chunkBase64 = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = (e) => resolve(e.target.result.split(',')[1]);
              reader.onerror = reject;
              reader.readAsDataURL(chunk);
            });

            // 上传块
            const response = await axios.post('http://localhost:5000/sftp_upload_file', {
              connection: props.connection,
              path: targetPath,
              filename: file.name,
              content: chunkBase64,
              chunkIndex: i,
              isLastChunk: isLastChunk,
              tempFileId: tempFileId,
              transferId: transferId,
              totalSize: file.size
            });

            // 检查响应状态
            if (response.data.status === 'cancelled') {
              isCancelled = true;
              throw new Error('Transfer cancelled');
            }

            if (!isLastChunk) {
              tempFileId = response.data.tempFileId;
            }
          }

          // 上传成功
          if (!isCancelled) {
            uploadInfo.status = 'success';
            uploadInfo.progress = 100;
            await logOperation('upload', `${targetPath}/${file.name}`);
            await refreshDirectoryKeepingState(targetPath);
          }

        } finally {
          clearInterval(progressTimer);
        }

      } catch (error) {
        console.error('Failed to upload file:', error);
        uploadInfo.status = 'error';

        if (error.message === 'Transfer cancelled') {
          if (!isCancelled) {
            Message.info(t('sftp.uploadCancelled'));
          }
        } else {
          Message.error(`Failed to upload ${file.name}: ${error.message}`);
        }
        throw error;

      } finally {
        if (loadingMessage) {
          loadingMessage.close();
        }
        // 根据状态决定是否隐藏进度条
        if (uploadInfo.status !== 'cancelled') {
          setTimeout(() => {
            uploadProgressVisible.value = false;
          }, 1000);
        }
      }
    };

    // 添加上传进度相关的状态
    const uploadProgressVisible = ref(false);
    const uploadInfo = reactive({
      fileName: '',
      progress: 0,
      status: 'normal',
      speed: '',
      timeRemaining: '',
      startTime: null,
      totalSize: 0,
      uploadedSize: 0,
      transferId: null  // 添加 transferId 字段
    });

    // 添加多选文件的状态
    const selectedFiles = ref([]);

    // 多选事件处理
    const onMultiSelect = (checkedKeys, { checkedNodes }) => {
      selectedFiles.value = checkedKeys;
    };

    // 下载多个文件的方法
    const downloadMultipleFiles = async () => {
      try {
        const selectedNodes = findNodesByKeys(selectedFiles.value);
        const fileNodes = selectedNodes.filter(node => node.isLeaf);

        if (fileNodes.length === 0) {
          Message.warning(t('sftp.noFilesSelected'));
          return;
        }

        const savePath = await dialog.showOpenDialog({
          title: t('sftp.selectDownloadFolder'),
          properties: ['openDirectory', 'createDirectory']
        });

        if (savePath.canceled) return;

        for (const node of fileNodes) {
          await downloadItem(node, savePath.filePaths[0]);
        }

        Message.success(t('sftp.multiDownloadSuccess', { count: fileNodes.length }));
      } catch (error) {
        console.error('Failed to download multiple files:', error);
        Message.error(t('sftp.multiDownloadFailed'));
      }
    };

    // 删除多个文件的方���
    const deleteMultipleFiles = async () => {
      try {
        const selectedNodes = findNodesByKeys(selectedFiles.value);
        
        // 分离文件和文件夹
        const fileNodes = selectedNodes.filter(node => node.isLeaf);
        const folderNodes = selectedNodes.filter(node => !node.isLeaf);

        // 如果没有选择任何文件或文件夹
        if (selectedNodes.length === 0) {
          Message.warning(t('sftp.noItemsSelected'));
          return;
        }

        // 按照路径深度排序文件夹，确保从最深层开始删除
        const sortedFolderNodes = folderNodes.sort((a, b) => 
          b.key.split('/').length - a.key.split('/').length
        );

        Modal.warning({
          title: t('sftp.deleteMultiple'),
          content: t('sftp.confirmDeleteMultipleItems', { 
            fileCount: fileNodes.length, 
            folderCount: folderNodes.length 
          }),
          okText: t('sftp.delete'),
          cancelText: t('sftp.cancel'),
          okButtonProps: {
            status: 'danger'
          },
          onOk: async () => {
            try {
              // 先删除文件
              for (const node of fileNodes) {
                await deleteItem(node.key);
              }

              // 再删除文件夹（从最深层开始）
              for (const node of sortedFolderNodes) {
                await deleteItem(node.key);
              }
              
              // 清空选择
              selectedFiles.value = [];
              
              // 刷新当前目录
              await refreshCurrentDirectory();
              
              Message.success(t('sftp.multiDeleteSuccess', { 
                fileCount: fileNodes.length, 
                folderCount: folderNodes.length 
              }));
            } catch (error) {
              console.error('Failed to delete multiple items:', error);
              Message.error(t('sftp.multiDeleteFailed'));
            }
          }
        });
      } catch (error) {
        console.error('Failed to prepare multiple deletion:', error);
        Message.error(t('sftp.multiDeleteFailed'));
      }
    };

    // 根 keys 查找节点的辅助方法
    const findNodesByKeys = (keys) => {
      const findInNodes = (nodes) => {
        const foundNodes = [];
        for (const node of nodes) {
          if (keys.includes(node.key)) {
            foundNodes.push(node);
          }
          if (node.children) {
            foundNodes.push(...findInNodes(node.children));
          }
        }
        return foundNodes;
      };
      return findInNodes(fileTree.value);
    };

    const formatModTime = (timestamp) => {
      if (!timestamp || timestamp === 0) {
        return 'Unknown Date';
      }
      
      try {
        const date = new Date(timestamp * 1000);
        return date.toLocaleString();
      } catch (error) {
        console.error('Error formatting timestamp:', timestamp, error);
        return 'Invalid Date';
      }
    };

    const formatSize = (size) => {
      if (!size || size === 0) {
        return '0 B';
      }
      
      try {
        const sizeNum = Number(size);
        if (isNaN(sizeNum)) {
          return '0 B';
        }
        
        if (sizeNum < 1024) return `${sizeNum} B`;
        if (sizeNum < 1024 * 1024) return `${(sizeNum / 1024).toFixed(2)} KB`;
        if (sizeNum < 1024 * 1024 * 1024) return `${(sizeNum / (1024 * 1024)).toFixed(2)} MB`;
        return `${(sizeNum / (1024 * 1024 * 1024)).toFixed(2)} GB`;
      } catch (error) {
        console.error('Error formatting size:', size, error);
        return '0 B';
      }
    };

    // 添加取消传输的方法
    const cancelUpload = async () => {
      try {
        if (uploadInfo.transferId) {
          const response = await axios.post(`http://localhost:5000/cancel_transfer/${uploadInfo.transferId}`);
          if (response.data.status === 'success') {
            // 立即更新状态
            uploadInfo.status = 'cancelled';
            // 立即隐藏进度条
            uploadProgressVisible.value = false;
            // 清除上传信息
            uploadInfo.fileName = '';
            uploadInfo.progress = 0;
            uploadInfo.speed = '';
            uploadInfo.timeRemaining = '';
            uploadInfo.transferred = '';
            uploadInfo.total = '';
            uploadInfo.transferId = null;
            // 显示取消消息（只显示一次）
            Message.info(t('sftp.uploadCancelled'));
          }
        }
      } catch (error) {
        console.error('Failed to cancel upload:', error);
        Message.error(t('sftp.cancelFailed'));
      }
    };

    const cancelDownload = async () => {
      try {
        if (downloadInfo.transferId) {
          const response = await axios.post(`http://localhost:5000/cancel_transfer/${downloadInfo.transferId}`);
          if (response.data.status === 'success') {
            // 立即隐藏进度条
            downloadProgressVisible.value = false;
            // 清除下载信息
            downloadInfo.fileName = '';
            downloadInfo.progress = 0;
            downloadInfo.status = 'normal';
            downloadInfo.speed = '';
            downloadInfo.timeRemaining = '';
            downloadInfo.transferred = '';
            downloadInfo.total = '';
            downloadInfo.transferId = null;
            downloadInfo.startTime = null;
            // 显示取消消息
            Message.info(t('sftp.downloadCancelled'));
          }
        }
      } catch (error) {
        console.error('Failed to cancel download:', error);
        Message.error(t('sftp.cancelFailed'));
      }
    };

    // 修改进度条更新逻辑
    const updateProgressBar = (type, progress) => {
      nextTick(() => {
        const progressBar = document.querySelector(
          `.${type}-progress .arco-progress-line-bar`
        );
        if (progressBar) {
          // 使用 CSS 变量设置宽度
          progressBar.style.setProperty('--progress-width', `${progress}%`);
          
          // 根据进度设置状态类
          if (progress === 100) {
            progressBar.classList.add('status-success');
          } else if (progress === 0) {
            progressBar.classList.remove('status-success', 'status-error');
          }
        }
      });
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
      uploadProgressVisible,
      uploadInfo,
      selectedFiles,
      onMultiSelect,
      downloadMultipleFiles,
      deleteMultipleFiles,
      findNodesByKeys,
      formatModTime,
      formatSize,
      cancelUpload,
      cancelDownload,
    };
  }
}
</script>

<style scoped>
@font-face {
  font-family: 'Arial';
  src: url('../utils/arial.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
}

.sftp-explorer {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  color: var(--color-text-1);
  position: relative;
  z-index: 9999;
  user-select: none;
  overflow: hidden;
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

.sftp-explorer-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
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

/* 自定���滚动条样式 */
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

/* 右键菜单中删除选的样式 */
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
  justify-content: space-between;
  padding: 4px 8px;
  width: 100%;
  min-height: 24px;
  transition: all 0.2s ease;
  cursor: pointer;
  border: 2px solid transparent;
}

/* 选中状���样式调整 */
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
.download-progress-float,
.upload-progress-float {
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

.progress-details {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-text-3);
}

/* 深色模式适配 */
:deep([arco-theme='dark']) .download-progress-float,
:deep([arco-theme='dark']) .upload-progress-float {
  background-color: var(--color-bg-3);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

/* 隐藏树节点的展开按钮 */
:deep(.arco-tree-node-switcher) {
  width: 0 !important;
  opacity: 0;
  pointer-events: none;
}

/* 调整树节点图标的位置 */
:deep(.arco-tree-node-title) {
  padding-left: 0 !important;
}

.item-details {
  display: flex;
  gap: 8px;
  color: var(--color-text-2);
}

.item-mod-time,
.item-size {
  font-size: 12px;
}

/* 添加宽度调整���域的样式 */
.sftp-explorer {
  position: relative;
  min-width: 300px;
}

.sftp-explorer-resizer {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 10px;
  cursor: col-resize;
  background: transparent;
  z-index: 1000;
}

.sftp-explorer-resizer:hover {
  background: rgba(var(--primary-6), 0.1);
}

.sftp-explorer-resizer:active {
  background: rgba(var(--primary-6), 0.2);
}

/* 添��自定义字体��览样式 */
.file-preview-modal .file-preview-content {
  font-family: 'Arial', sans-serif;
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 500px;
  overflow-y: auto;
}

/* 添加或修改样式 */
.progress-bar-wrapper {
  width: 100%;
  margin: 8px 0;
  position: relative;
  overflow: hidden;
}

/* 修改 Arco Design 进度条样式 */
:deep(.arco-progress) {
  width: 100%;
}

:deep(.arco-progress-line) {
  width: 100%;
}

:deep(.arco-progress-line-bar) {
  transition: width 0.3s ease;
}

/* 确保进度条容器和进度条本身的宽度一致 */
.upload-progress,
.download-progress {
  width: 100%;
}

:deep(.arco-progress-line-bar) {
  width: var(--progress-width, 0%) !important;
}

/* 修改进度条颜色状态 */
:deep(.arco-progress-line-bar.status-success) {
  background-color: var(--color-success-light-4);
}

:deep(.arco-progress-line-bar.status-error) {
  background-color: var(--color-danger-light-4);
}

.upload-progress-float,
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
}

.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
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

.progress-details {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-3);
}

/* 添加关闭按钮样式 */
.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.close-button {
  padding: 2px;
  margin-left: 8px;
}

.close-button:hover {
  background-color: var(--color-fill-3);
}
</style>


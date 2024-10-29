import enUS from '@arco-design/web-vue/es/locale/lang/en-us'
import zhCN from '@arco-design/web-vue/es/locale/lang/zh-cn'

// 自定义文本翻译
const customMessages = {
  'en-US': {
    common: {
      delete: 'Delete',
      rename: 'Rename',
      refresh: 'Refresh',
      upload: 'Upload',
      download: 'Download',
      newFolder: 'New Folder',
      cancel: 'Cancel',
      confirm: 'Confirm',
      save: 'Save',
      create: 'Create',
      edit: 'Edit',
      addFolder: 'Add Folder',
      addConnection: 'Add Connection',
      folderName: 'Folder Name',
      editFolder: 'Edit Folder',
      deleteFolder: 'Delete Folder',
      deleteFile: 'Delete File',
      name: 'Name',
      host: 'Host',
      port: 'Port',
      username: 'Username',
      password: 'Password',
      authentication: 'Authentication',
      privateKey: 'Private Key',
      selectFile: 'Select File',
      history: 'History',
      enterNewName: 'Enter new name',
      enterFolderName: 'Enter folder name'
    },
    settings: {
      title: 'Settings',
      language: 'Language',
      saved: 'Settings saved successfully',
      pingInterval: 'PING Interval',
      pingIntervalDescription: 'Set to 0 to disable PING. Maximum value is 3600 seconds (1 hour).'
    },
    messages: {
      confirmDelete: 'Are you sure you want to delete "{name}"?',
      cannotUndo: 'This action cannot be undone.',
      uploadSuccess: 'Uploaded successfully',
      downloadSuccess: 'Downloaded successfully',
      createFolderSuccess: 'Folder created successfully',
      folderExists: 'Folder already exists',
      pleaseEnterName: 'Please enter a name',
      connectionSaved: 'Connection saved successfully',
      connectionDeleted: 'Connection deleted successfully',
      folderDeleted: 'Folder deleted successfully'
    }
  },
  'zh-CN': {
    common: {
      delete: '删除',
      rename: '重命名',
      refresh: '刷新',
      upload: '上传',
      download: '下载',
      newFolder: '新建文件夹',
      cancel: '取消',
      confirm: '确认',
      save: '保存',
      create: '创建',
      edit: '编辑',
      addFolder: '添加文件夹',
      addConnection: '添加连接',
      folderName: '文件夹名称',
      editFolder: '编辑文件夹',
      deleteFolder: '删除文件夹',
      deleteFile: '删除文件',
      name: '名称',
      host: '主机',
      port: '端口',
      username: '用户名',
      password: '密码',
      authentication: '认证方式',
      privateKey: '私钥',
      selectFile: '选择文件',
      history: '历史记录',
      enterNewName: '输入新名称',
      enterFolderName: '输入文件夹名称'
    },
    settings: {
      title: '设置',
      language: '语言',
      saved: '设置保存成功',
      pingInterval: 'PING 间隔',
      pingIntervalDescription: '设置为 0 以禁用 PING。最大值为 3600 秒（1小时）。'
    },
    messages: {
      confirmDelete: '确定要删除 "{name}" 吗？',
      cannotUndo: '此操作无法撤销。',
      uploadSuccess: '上传成功',
      downloadSuccess: '下载成功',
      createFolderSuccess: '文件夹创建成功',
      folderExists: '文件夹已存在',
      pleaseEnterName: '请输入名称',
      connectionSaved: '连接保存成功',
      connectionDeleted: '连接删除成功',
      folderDeleted: '文件夹删除成功'
    }
  }
}

// 创建混合语言包
const mergedLocales = {
  'en-US': {
    ...enUS,
    ...customMessages['en-US']
  },
  'zh-CN': {
    ...zhCN,
    ...customMessages['zh-CN']
  }
}

// 创建 i18n 插件
export const i18n = {
  install: (app) => {
    // 添加全局属性
    app.config.globalProperties.$t = function(key) {
      const currentLocale = this.locale?.name || 'en-US'
      const messages = mergedLocales[currentLocale] || mergedLocales['en-US']
      return key.split('.').reduce((o, i) => (o || {})[i], messages)
    }

    // 提供混合的语言包
    app.config.globalProperties.$locales = mergedLocales

    // 修改 mixin 实现
    app.mixin({
      data() {
        return {
          currentLanguage: 'en-US'
        }
      },
      computed: {
        currentLocale() {
          return this.locale?.name || this.currentLanguage
        }
      },
      watch: {
        'locale.name': {
          handler(newVal) {
            if (newVal) {
              this.currentLanguage = newVal
            }
          },
          immediate: true
        }
      }
    })
  }
}

// 导出语言包
export const messages = customMessages
export const arcoLocales = {
  'en-US': enUS,
  'zh-CN': zhCN
} 
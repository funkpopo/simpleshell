<template>
  <div class="connection-dialog-wrapper" @click.self="closeModal">
    <div
      class="connection-dialog"
      :class="{ 'organization-mode': isOrganization }"
    >
      <div class="dialog-header">
        <h2>
          {{
            isEditMode
              ? t(
                  isOrganization
                    ? "connection.editOrganization"
                    : "connection.editConnection",
                )
              : t(
                  isOrganization
                    ? "connection.newOrganization"
                    : "connection.newConnection",
                )
          }}
        </h2>
        <button class="close-btn" @click="closeModal">×</button>
      </div>

      <div class="dialog-content">
        <!-- 组织/连接名称 -->
        <div class="form-group">
          <label for="name"
            >{{ t("connection.name") }} <span class="required">*</span></label
          >
          <input
            type="text"
            id="name"
            v-model="formData.name"
            :placeholder="isOrganization ? '组织名称' : 'SSH连接名称'"
            @input="validateForm"
          />
          <div class="error-message" v-if="validation.name">
            {{ validation.name }}
          </div>
        </div>

        <!-- 连接信息 (仅在非组织模式下显示) -->
        <template v-if="!isOrganization">
          <div class="form-group">
            <label for="host"
              >{{ t("connection.host") }} <span class="required">*</span></label
            >
            <input
              type="text"
              id="host"
              v-model="formData.host"
              placeholder="server.example.com"
              @input="validateForm"
            />
            <div class="error-message" v-if="validation.host">
              {{ validation.host }}
            </div>
          </div>

          <div class="form-group">
            <label for="port"
              >{{ t("connection.port") }} <span class="required">*</span></label
            >
            <input
              type="number"
              id="port"
              v-model.number="formData.port"
              placeholder="22"
              @input="validateForm"
            />
            <div class="error-message" v-if="validation.port">
              {{ validation.port }}
            </div>
            <div class="hint-text" v-else>
              {{ t("connection.defaultPort") }}
            </div>
          </div>

          <div class="form-group">
            <label for="username"
              >{{ t("connection.username") }}
              <span class="required">*</span></label
            >
            <input
              type="text"
              id="username"
              v-model="formData.username"
              placeholder="root"
              @input="validateForm"
            />
            <div class="error-message" v-if="validation.username">
              {{ validation.username }}
            </div>
          </div>

          <div class="form-group">
            <label for="password">{{ t("connection.password") }}</label>
            <input
              type="password"
              id="password"
              v-model="formData.password"
              placeholder="••••••••"
              @input="validateForm"
            />
            <div class="error-message" v-if="validation.password">
              {{ validation.password }}
            </div>
          </div>

          <div class="form-group">
            <label for="privateKey">{{ t("connection.privateKey") }}</label>
            <div class="file-input-wrapper">
              <input
                type="text"
                id="privateKey"
                v-model="formData.privateKey"
                placeholder="~/.ssh/id_rsa"
                readonly
              />
              <button class="select-file-btn" @click="selectPrivateKeyFile">
                {{ t("connection.selectFile") }}
              </button>
              <button
                class="clear-file-btn"
                @click="clearPrivateKey"
                v-if="formData.privateKey"
              >
                {{ t("connection.clear") }}
              </button>
            </div>
            <div class="error-message" v-if="validation.privateKey">
              {{ validation.privateKey }}
            </div>
            <div class="error-message" v-if="validation.authMethod">
              {{ validation.authMethod }}
            </div>
          </div>

          <div class="form-group">
            <label for="description">{{ t("connection.description") }}</label>
            <textarea
              id="description"
              v-model="formData.description"
              rows="3"
              placeholder="可选备注信息"
            ></textarea>
          </div>
        </template>

        <!-- 高级设置 -->
        <div v-if="!isOrganization" class="advanced-settings-section">
          <details>
            <summary>{{ t("connection.advancedSettings") }}</summary>
            <SSHAdvancedSettings />
          </details>
        </div>
      </div>

      <div class="dialog-footer">
        <button class="cancel-btn" @click="closeModal">
          {{ t("common.cancel") }}
        </button>
        <button
          class="save-btn"
          @click="saveConnection"
          :disabled="!isFormValid || isSaving"
        >
          {{ isSaving ? t("common.saving") : t("common.save") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { useI18n } from "../i18n";
import SSHAdvancedSettings from "./SSHAdvancedSettings.vue";

const { t } = useI18n();

// 接收属性
const props = defineProps<{
  isEditMode: boolean;
  isOrganization: boolean;
  connectionData?: any;
  organizationId?: string;
}>();

// 定义事件
const emit = defineEmits<{
  (e: "close"): void;
  (e: "save", data: any): void;
}>();

// 表单数据
const formData = reactive({
  id: "",
  name: "",
  host: "",
  port: 22,
  username: "",
  password: "",
  privateKey: "",
  privateKeyPath: "",
  description: "",
});

// 表单验证状态
const validation = reactive({
  name: "",
  host: "",
  port: "",
  username: "",
  password: "",
  privateKey: "",
  authMethod: "",
});

// 保存状态
const isSaving = ref(false);
const isFormValid = ref(false);

// 初始化表单数据
onMounted(() => {
  if (props.isEditMode && props.connectionData) {
    // 编辑模式，填充现有数据
    Object.assign(formData, props.connectionData);
  } else if (!props.isOrganization) {
    // 新连接默认值
    formData.port = 22;
  }

  // 初始验证
  validateForm();
});

// 验证表单
function validateForm() {
  // 重置验证状态
  Object.keys(validation).forEach((key) => {
    validation[key as keyof typeof validation] = "";
  });

  // 验证名称
  if (!formData.name.trim()) {
    validation.name = t("connection.required");
  }

  // 非组织模式时的其他验证
  if (!props.isOrganization) {
    // 验证主机
    if (!formData.host.trim()) {
      validation.host = t("connection.required");
    }

    // 验证端口
    if (!formData.port) {
      validation.port = t("connection.required");
    } else if (formData.port < 1 || formData.port > 65535) {
      validation.port = t("connection.portRange");
    }

    // 验证用户名
    if (!formData.username.trim()) {
      validation.username = t("connection.required");
    }

    // 验证认证方式
    if (!formData.password && !formData.privateKey) {
      validation.authMethod = t("connection.atLeastOne");
    }
  }

  // 更新表单有效性状态
  isFormValid.value = !Object.values(validation).some((val) => val !== "");
}

// 选择私钥文件
async function selectPrivateKeyFile() {
  try {
    const result = await window.api.openFileDialog({
      title: t("connection.selectPrivateKey"),
      buttonLabel: t("connection.selectFile"),
      properties: ["openFile"],
    });

    if (!result.canceled && result.filePath) {
      formData.privateKeyPath = result.filePath;

      // 如果文件内容可用，直接使用
      if (result.fileContent) {
        formData.privateKey = result.fileContent;
      } else {
        formData.privateKey = t("connection.savedPrivateKey");
      }

      validateForm();
    }
  } catch (error) {
    console.error("选择私钥文件失败:", error);
  }
}

// 清除私钥
function clearPrivateKey() {
  formData.privateKey = "";
  formData.privateKeyPath = "";
  validateForm();
}

// 关闭对话框
function closeModal() {
  emit("close");
}

// 保存连接
async function saveConnection() {
  if (!isFormValid.value) return;

  try {
    isSaving.value = true;

    // 构建保存数据
    const saveData = { ...formData };

    // 如果是新建连接，生成ID
    if (!props.isEditMode) {
      saveData.id = props.isOrganization
        ? `${Date.now()}`
        : `${props.organizationId}-${Date.now()}`;
    }

    // 发送保存事件
    emit("save", saveData);

    // 关闭对话框
    setTimeout(() => {
      isSaving.value = false;
      closeModal();
    }, 500);
  } catch (error) {
    console.error("保存连接失败:", error);
    isSaving.value = false;
  }
}
</script>

<style scoped>
.connection-dialog-wrapper {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.connection-dialog {
  background: var(--bg-color);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  width: 90%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.connection-dialog.organization-mode {
  max-width: 400px;
}

.dialog-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dialog-header h2 {
  margin: 0;
  font-size: 18px;
  color: var(--heading-color);
  font-weight: 500;
}

.close-btn {
  background: transparent;
  border: none;
  font-size: 24px;
  color: var(--text-color);
  cursor: pointer;
  line-height: 1;
}

.dialog-content {
  padding: 20px;
  flex: 1;
  overflow-y: auto;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  color: var(--label-color);
}

.form-group input,
.form-group textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 14px;
  background: var(--input-bg);
  color: var(--text-color);
}

.form-group input:focus,
.form-group textarea:focus {
  border-color: var(--primary-color);
  outline: none;
}

.form-group textarea {
  resize: vertical;
  min-height: 80px;
}

.file-input-wrapper {
  display: flex;
  gap: 8px;
}

.file-input-wrapper input {
  flex: 1;
}

.select-file-btn,
.clear-file-btn {
  white-space: nowrap;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--button-bg);
  color: var(--text-color);
  cursor: pointer;
  font-size: 14px;
}

.select-file-btn:hover,
.clear-file-btn:hover {
  background: var(--button-hover-bg);
}

.required {
  color: #e53935;
  margin-left: 2px;
}

.error-message {
  color: #e53935;
  font-size: 12px;
  margin-top: 4px;
}

.hint-text {
  color: var(--hint-color);
  font-size: 12px;
  margin-top: 4px;
}

.dialog-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.cancel-btn,
.save-btn {
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  border: none;
}

.cancel-btn {
  background: var(--cancel-button-bg);
  color: var(--text-color);
}

.save-btn {
  background: var(--primary-color);
  color: white;
}

.save-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.advanced-settings-section {
  margin-top: 16px;
  border-top: 1px solid var(--border-color);
  padding-top: 16px;
}

.advanced-settings-section summary {
  cursor: pointer;
  user-select: none;
  font-weight: 500;
  color: var(--heading-color);
}

:root {
  --bg-color: #ffffff;
  --text-color: #333333;
  --heading-color: #222222;
  --label-color: #555555;
  --border-color: #e0e0e0;
  --input-bg: #ffffff;
  --button-bg: #f5f5f5;
  --button-hover-bg: #e0e0e0;
  --primary-color: #1976d2;
  --hint-color: #888888;
  --cancel-button-bg: #f5f5f5;
}

:root .dark-theme {
  --bg-color: #2d2d2d;
  --text-color: #e0e0e0;
  --heading-color: #ffffff;
  --label-color: #bbbbbb;
  --border-color: #444444;
  --input-bg: #3d3d3d;
  --button-bg: #444444;
  --button-hover-bg: #555555;
  --primary-color: #2196f3;
  --hint-color: #888888;
  --cancel-button-bg: #444444;
}
</style>

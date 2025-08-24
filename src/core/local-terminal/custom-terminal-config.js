const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class CustomTerminalConfig {
  constructor() {
    this.configPath = path.join(app.getPath('userData'), 'custom-terminals.json');
    this.customTerminals = [];
    this.loadConfig();
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        this.customTerminals = JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to load custom terminal config:', error);
      this.customTerminals = [];
    }
  }

  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.customTerminals, null, 2));
      return true;
    } catch (error) {
      console.error('Failed to save custom terminal config:', error);
      return false;
    }
  }

  getAllCustomTerminals() {
    return [...this.customTerminals];
  }

  addCustomTerminal(terminal) {
    // 验证必要字段
    if (!terminal.name || !terminal.executable) {
      throw new Error('Terminal name and executable are required');
    }

    // 生成唯一ID
    terminal.id = `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    terminal.type = 'custom';
    terminal.isCustom = true;
    
    // 设置默认值
    terminal.args = terminal.args || [];
    terminal.env = terminal.env || {};
    terminal.cwd = terminal.cwd || null;
    terminal.icon = terminal.icon || 'terminal';
    
    this.customTerminals.push(terminal);
    this.saveConfig();
    
    return terminal;
  }

  updateCustomTerminal(id, updates) {
    const index = this.customTerminals.findIndex(t => t.id === id);
    if (index === -1) {
      throw new Error('Terminal not found');
    }

    // 保留原有ID和类型
    const updatedTerminal = {
      ...this.customTerminals[index],
      ...updates,
      id: this.customTerminals[index].id,
      type: 'custom',
      isCustom: true
    };

    this.customTerminals[index] = updatedTerminal;
    this.saveConfig();
    
    return updatedTerminal;
  }

  deleteCustomTerminal(id) {
    const index = this.customTerminals.findIndex(t => t.id === id);
    if (index === -1) {
      throw new Error('Terminal not found');
    }

    const deleted = this.customTerminals.splice(index, 1)[0];
    this.saveConfig();
    
    return deleted;
  }

  getCustomTerminal(id) {
    return this.customTerminals.find(t => t.id === id);
  }

  // 不再自动添加预设应用，让用户自行添加需要的应用
  addPresetApplications() {
    // 预设功能已禁用，用户可通过界面自行添加需要的应用
    return;
  }
}

module.exports = CustomTerminalConfig;
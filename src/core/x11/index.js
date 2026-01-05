/**
 * X11模块入口
 */

const xserverManager = require('./xserver-manager');
const { setupX11Forwarding, getShellOptions } = require('./x11-forwarding');

module.exports = {
  xserverManager,
  setupX11Forwarding,
  getShellOptions,
};

import { useState, useEffect, useCallback } from 'react';

const useNetworkState = () => {
  const [networkState, setNetworkState] = useState({
    isOnline: true,
    quality: 'excellent',
    capabilities: null,
    lastCheck: null,
    offlineDuration: 0,
    isLoading: false
  });

  const [connectionHistory, setConnectionHistory] = useState([]);

  // 检查功能是否可用
  const isFeatureAvailable = useCallback(async (feature) => {
    try {
      const result = await window.electronAPI.invoke('network:isFeatureAvailable', feature);
      if (result.success) {
        return result.data;
      }
      return { available: true, message: null };
    } catch (error) {
      console.error('检查功能可用性失败:', error);
      return { available: true, message: null };
    }
  }, []);

  // 手动检查网络状态
  const checkNetworkNow = useCallback(async () => {
    setNetworkState(prev => ({ ...prev, isLoading: true }));
    
    try {
      const result = await window.electronAPI.invoke('network:checkNow');
      if (result.success) {
        setNetworkState(prev => ({
          ...prev,
          isOnline: result.data.isOnline,
          quality: result.data.quality,
          lastCheck: Date.now(),
          isLoading: false
        }));
        
        // 添加到连接历史
        setConnectionHistory(prev => [
          { 
            timestamp: Date.now(), 
            isOnline: result.data.isOnline, 
            quality: result.data.quality,
            latency: result.data.latency 
          },
          ...prev.slice(0, 19) // 保留最近20条记录
        ]);
      }
    } catch (error) {
      console.error('手动网络检测失败:', error);
      setNetworkState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  // 获取网络状态
  const getNetworkState = useCallback(async () => {
    try {
      const result = await window.electronAPI.invoke('network:getState');
      if (result.success) {
        setNetworkState(prev => ({
          ...prev,
          ...result.data,
          lastCheck: Date.now()
        }));
      }
    } catch (error) {
      console.error('获取网络状态失败:', error);
    }
  }, []);

  // 监听网络状态变化
  useEffect(() => {
    // 初始化时获取网络状态
    getNetworkState();

    // 监听网络状态变化事件
    const handleNetworkStateChanged = (event, data) => {
      setNetworkState(prev => ({
        ...prev,
        isOnline: data.isOnline,
        quality: data.quality || prev.quality,
        capabilities: data.capabilities || null,
        offlineDuration: data.offlineDuration || 0,
        lastCheck: Date.now()
      }));

      // 添加到连接历史
      setConnectionHistory(prev => [
        { 
          timestamp: Date.now(), 
          isOnline: data.isOnline, 
          quality: data.quality,
          event: data.isOnline ? 'reconnected' : 'disconnected'
        },
        ...prev.slice(0, 19)
      ]);
    };

    const handleOfflineModeActivated = (event, data) => {
      setNetworkState(prev => ({
        ...prev,
        isOnline: false,
        capabilities: data.capabilities,
        lastCheck: Date.now()
      }));
    };

    // 注册事件监听器
    if (window.electronAPI && window.electronAPI.on) {
      window.electronAPI.on('network-state-changed', handleNetworkStateChanged);
      window.electronAPI.on('activate-offline-mode', handleOfflineModeActivated);
    }

    // 定期检查网络状态（每分钟）
    const intervalId = setInterval(getNetworkState, 60000);

    return () => {
      clearInterval(intervalId);
      // 清理事件监听器
      if (window.electronAPI && window.electronAPI.removeListener) {
        window.electronAPI.removeListener('network-state-changed', handleNetworkStateChanged);
        window.electronAPI.removeListener('activate-offline-mode', handleOfflineModeActivated);
      }
    };
  }, [getNetworkState]);

  // 获取连接质量描述
  const getQualityDescription = useCallback((quality) => {
    const descriptions = {
      'excellent': { text: '优秀', color: '#4caf50' },
      'good': { text: '良好', color: '#ff9800' },
      'poor': { text: '较差', color: '#f44336' },
      'offline': { text: '离线', color: '#9e9e9e' }
    };
    return descriptions[quality] || descriptions['offline'];
  }, []);

  // 获取离线功能提示
  const getOfflineCapabilityMessage = useCallback((feature) => {
    if (networkState.isOnline) {
      return null;
    }

    const capabilities = networkState.capabilities || {};
    if (capabilities[feature]) {
      return null; // 功能在离线模式下可用
    }

    const messages = {
      sshConnections: '离线模式下无法建立SSH连接',
      fileTransfer: '离线模式下无法进行文件传输',
      aiChat: '离线模式下AI聊天功能不可用',
      settingsSync: '离线模式下设置无法同步到云端',
      fileOperations: '离线模式下无法进行远程文件操作'
    };

    return messages[feature] || '该功能在离线模式下不可用';
  }, [networkState.isOnline, networkState.capabilities]);

  return {
    networkState,
    connectionHistory,
    isFeatureAvailable,
    checkNetworkNow,
    getQualityDescription,
    getOfflineCapabilityMessage
  };
};

export default useNetworkState;
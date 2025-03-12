import crypto from 'crypto'
import os from 'os'
import { machineIdSync } from 'node-machine-id'

// AES 加密配置
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16  // 初始化向量长度
const KEY_LENGTH = 32  // 密钥长度 (256 位)
const ENCODING = 'utf8'

// 密钥派生 - 使用机器ID和操作系统信息
function deriveEncryptionKey(): Buffer {
  try {
    // 尝试获取机器唯一ID
    const machineId = machineIdSync()
    
    // 结合OS信息生成长种子
    const seed = `${machineId}-${os.hostname()}-${os.platform()}-${os.arch()}-simpleshell-secure-storage`
    
    // 使用PBKDF2派生密钥
    return crypto.pbkdf2Sync(
      seed,
      'simpleshell-salt',  // 固定盐值
      10000,  // 迭代次数
      KEY_LENGTH,
      'sha512'
    )
  } catch (error) {
    console.error('密钥派生失败，使用备用方法:', error)
    
    // 备用方法 - 使用OS信息创建一个相对较弱但仍能工作的密钥
    const fallbackSeed = `${os.hostname()}-${os.platform()}-${os.arch()}-${os.userInfo().username}-${os.totalmem()}`
    return crypto.createHash('sha256').update(fallbackSeed).digest()
  }
}

// 加密字符串
export function encryptString(text: string): string {
  if (!text) return text  // 不加密空字符串
  
  try {
    const key = deriveEncryptionKey()
    const iv = crypto.randomBytes(IV_LENGTH)
    
    // 创建加密器
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
    
    // 加密数据
    let encrypted = cipher.update(text, ENCODING, 'hex')
    encrypted += cipher.final('hex')
    
    // 获取认证标签
    const authTag = cipher.getAuthTag()
    
    // 将IV和认证标签附加到加密结果
    // 格式: hex(iv) + ':' + hex(authTag) + ':' + hex(encryptedData)
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
  } catch (error) {
    console.error('加密失败:', error)
    return text  // 加密失败时返回原文
  }
}

// 解密字符串
export function decryptString(encryptedText: string): string {
  if (!encryptedText) return encryptedText  // 不处理空字符串
  
  // 检查是否是加密格式
  if (!encryptedText.includes(':')) {
    return encryptedText  // 不是加密格式，直接返回
  }
  
  try {
    const key = deriveEncryptionKey()
    
    // 分离IV、认证标签和加密数据
    const parts = encryptedText.split(':')
    if (parts.length !== 3) {
      console.error('解密失败: 无效的加密格式')
      return encryptedText  // 格式错误时返回原文
    }
    
    const iv = Buffer.from(parts[0], 'hex')
    const authTag = Buffer.from(parts[1], 'hex')
    const encrypted = parts[2]
    
    // 创建解密器
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    
    // 解密数据
    let decrypted = decipher.update(encrypted, 'hex', ENCODING)
    decrypted += decipher.final(ENCODING)
    
    return decrypted
  } catch (error) {
    console.error('解密失败:', error)
    return encryptedText  // 解密失败时返回原文
  }
}

// 处理连接对象 - 加密敏感字段
export function encryptConnection(conn: any): any {
  if (!conn) return conn
  
  // 创建深拷贝
  const encryptedConn = { ...conn }
  
  // 加密敏感字段
  if (encryptedConn.password) {
    encryptedConn.password = encryptString(encryptedConn.password)
  }
  
  if (encryptedConn.privateKey) {
    encryptedConn.privateKey = encryptString(encryptedConn.privateKey)
  }
  
  return encryptedConn
}

// 处理连接对象 - 解密敏感字段
export function decryptConnection(conn: any): any {
  if (!conn) return conn
  
  // 创建深拷贝
  const decryptedConn = { ...conn }
  
  // 解密敏感字段
  if (decryptedConn.password) {
    decryptedConn.password = decryptString(decryptedConn.password)
  }
  
  if (decryptedConn.privateKey) {
    decryptedConn.privateKey = decryptString(decryptedConn.privateKey)
  }
  
  return decryptedConn
} 
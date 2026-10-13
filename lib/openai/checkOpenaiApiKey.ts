export function checkOpenaiApiKey(str: string) {
  // PATCH(K): 自部署多厂商 BYOK——纯 Key（sk-xxx / xxx.yyy 任意 OpenAI 兼容 Key）或扩展语法
  const parts = str.split('|')
  if (parts.length === 1) {
    return /^[A-Za-z0-9][A-Za-z0-9\-.]{15,199}$/.test(parts[0])
  }
  if (parts.length === 2 || parts.length === 3) {
    if (!/^https?:\/\/.+/.test(parts[0])) return false
    if (!/^[A-Za-z0-9][A-Za-z0-9\-.]{15,199}$/.test(parts[1])) return false
    if (parts.length === 3 && !/^[A-Za-z0-9][A-Za-z0-9\-.\/]{0,100}$/.test(parts[2])) return false
    return true
  }
  return false
}

export function checkOpenaiApiKeys(str: string) {
  if (str.includes(',')) {
    const userApiKeys = str.split(',')
    return userApiKeys.every(checkOpenaiApiKey)
  }

  return checkOpenaiApiKey(str)
}

// api/auth.js
import bcrypt from 'bcrypt';

/**
 * 对密码进行哈希加密
 * @param {string} password - 明文密码
 * @param {number} rounds - 加密轮数，默认10
 * @returns {Promise<string>} 加密后的哈希值
 */
export async function hashPassword(password, rounds = 10) {
  if (!password) {
    throw new Error('密码不能为空');
  }
  return await bcrypt.hash(password, rounds);
}

/**
 * 验证明文密码与哈希值是否匹配
 * @param {string} plainPassword - 明文密码
 * @param {string} hashedPassword - 哈希密码
 * @returns {Promise<boolean>} 是否匹配
 */
export async function verifyPassword(plainPassword, hashedPassword) {
  if (!plainPassword || !hashedPassword) {
    return false;
  }
  return await bcrypt.compare(plainPassword, hashedPassword);
}
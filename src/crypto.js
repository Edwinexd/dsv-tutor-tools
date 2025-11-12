/**
 * Encryption utilities for credential protection
 */

/**
 * Decrypt encrypted credentials
 * @param {string} encryptedData - Format: "iv:authTag:ciphertext" (all base64)
 * @param {string} keyBase64 - Base64-encoded AES-256 key
 * @returns {Promise<{username: string, password: string}>}
 */
export async function decryptCredentials(encryptedData, keyBase64) {
  try {
    // Parse encrypted data (format: iv:authTag:ciphertext)
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const [ivBase64, authTagBase64, ciphertextBase64] = parts;

    // Decode from base64
    const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
    const authTag = Uint8Array.from(atob(authTagBase64), c => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(ciphertextBase64), c => c.charCodeAt(0));

    // Combine ciphertext and authTag for AES-GCM
    const combined = new Uint8Array(ciphertext.length + authTag.length);
    combined.set(ciphertext);
    combined.set(authTag, ciphertext.length);

    // Import key
    const keyData = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
        tagLength: 128
      },
      key,
      combined
    );

    // Convert to string and parse
    const plaintext = new TextDecoder().decode(decrypted);
    if (!plaintext.includes(':')) {
      throw new Error('Invalid credentials format');
    }

    const [username, password] = plaintext.split(':', 2);
    return { username, password };
  } catch (e) {
    throw new Error(`Decryption failed: ${e.message}`);
  }
}

/**
 * Verify digest matches the encrypted data
 * @param {string} digest - Expected SHA-256 digest (hex)
 * @param {string} secret - Secret key
 * @param {string} encryptedAuth - Encrypted credentials
 * @returns {Promise<boolean>}
 */
export async function verifyDigest(digest, secret, encryptedAuth) {
  const encoder = new TextEncoder();
  const data = encoder.encode(secret + encryptedAuth);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return digest === hashHex;
}

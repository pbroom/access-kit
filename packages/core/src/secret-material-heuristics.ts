const SENSITIVE_KEY_PATTERN = /(?:secret|token|password|credential|accesskey|privatekey|signingkey|hmackey|encryptionkey)/;

const SENSITIVE_KEY_NAMES = new Set([
  "accesskey",
  "accesstoken",
  "apikey",
  "apisecret",
  "apitoken",
  "authtoken",
  "authorization",
  "bearertoken",
  "clientkey",
  "clientsecret",
  "cookie",
  "idtoken",
  "refreshtoken",
  "sessiontoken",
  "setcookie",
  "token",
  "tokenmaterial",
  "tokenvalue",
  "xapikey"
]);

export function isSecretMaterialSensitiveKey(key: string): boolean {
  const normalized = key.replaceAll(/[-_\s]/g, "").toLowerCase();

  return SENSITIVE_KEY_PATTERN.test(normalized) || SENSITIVE_KEY_NAMES.has(normalized);
}

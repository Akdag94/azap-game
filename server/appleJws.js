/**
 * StoreKit 2 imzalı işlem (JWS) doğrulaması.
 *
 * iOS 15+ StoreKit 2'de istemcinin elindeki kanıt eski tip base64 App Store
 * receipt'i değil, Apple'ın ES256 ile imzaladığı JWS'tir. Burada imza zinciri
 * Apple Root CA - G3'e kadar doğrulanır; kök sertifika PİNLENMİŞTİR — zincirin
 * kökü birebir bu sertifika değilse doğrulama reddedilir (aksi halde saldırgan
 * kendi ürettiği zincirle bedava altın tanımlatabilirdi).
 */
const crypto = require('crypto');

// https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
// SHA-256: 63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79
const APPLE_ROOT_CA_G3_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;

const _rootCache = new Map();
function _root(pem) {
  if (!_rootCache.has(pem)) _rootCache.set(pem, new crypto.X509Certificate(pem));
  return _rootCache.get(pem);
}

/** Üç parçalı base64url JWS'e benziyor mu? (eski tip receipt'ten ayırmak için) */
function looksLikeJws(s) {
  if (typeof s !== 'string') return false;
  const parts = s.split('.');
  if (parts.length !== 3) return false;
  return parts.every((p) => p.length > 0 && /^[A-Za-z0-9_-]+$/.test(p));
}

function _b64urlJson(seg) {
  return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
}

/**
 * JWS'i doğrula; geçerliyse çözülmüş işlem payload'ını, değilse null döner.
 * Doğrulanan: alg=ES256, zincir pinlenmiş kökte bitiyor, her sertifika bir üstü
 * tarafından imzalanmış ve geçerlilik tarihinde, gövde imzası doğru.
 *
 * @param {string} jws
 * @param {{rootPem?: string, now?: number}} [opts] rootPem yalnızca testler için
 */
function verifyAppleJws(jws, opts = {}) {
  const rootPem = opts.rootPem || APPLE_ROOT_CA_G3_PEM;
  const now = opts.now || Date.now();
  try {
    const parts = String(jws).split('.');
    if (parts.length !== 3) return null;
    const header = _b64urlJson(parts[0]);
    if (header.alg !== 'ES256' || !Array.isArray(header.x5c) || header.x5c.length < 2) return null;

    const certs = header.x5c.map((der) => new crypto.X509Certificate(Buffer.from(der, 'base64')));
    // Zincirin kökü PİNLENMİŞ kök sertifikanın aynısı olmalı
    if (!certs[certs.length - 1].raw.equals(_root(rootPem).raw)) return null;

    for (const c of certs) {
      if (now < Date.parse(c.validFrom) || now > Date.parse(c.validTo)) return null;
    }
    for (let i = 0; i < certs.length - 1; i++) {
      if (!certs[i].checkIssued(certs[i + 1])) return null;
      if (!certs[i].verify(certs[i + 1].publicKey)) return null;
    }

    const ok = crypto
      .createVerify('SHA256')
      .update(parts[0] + '.' + parts[1])
      .verify({ key: certs[0].publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'));
    if (!ok) return null;

    return _b64urlJson(parts[1]);
  } catch (e) {
    console.warn('[IAP] JWS doğrulanamadı:', e.message);
    return null;
  }
}

module.exports = { looksLikeJws, verifyAppleJws, APPLE_ROOT_CA_G3_PEM };

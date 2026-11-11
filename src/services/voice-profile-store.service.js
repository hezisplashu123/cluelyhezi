const fs = require('fs');
const path = require('path');

class VoiceProfileStore {
  initialize(userDataPath, safeStorage) {
    this.safeStorage = safeStorage;
    this.directory = path.join(userDataPath, 'voice-recognition');
    this.file = path.join(this.directory, 'profile.enc');
  }

  isEncryptionAvailable() {
    return !!this.safeStorage?.isEncryptionAvailable?.();
  }

  save(profile) {
    if (!this.isEncryptionAvailable()) throw new Error('Operating-system secure storage is unavailable; the voice profile was not saved.');
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const encrypted = this.safeStorage.encryptString(JSON.stringify(profile));
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, encrypted, { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return null;
    if (!this.isEncryptionAvailable()) throw new Error('The saved voice profile cannot be decrypted on this system.');
    const value = JSON.parse(this.safeStorage.decryptString(fs.readFileSync(this.file)));
    if (!value || value.schemaVersion !== 1 || !Array.isArray(value.embedding)) throw new Error('The saved voice profile is invalid.');
    return value;
  }

  delete() {
    if (this.file && fs.existsSync(this.file)) fs.rmSync(this.file, { force: true });
  }
}

module.exports = new VoiceProfileStore();

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../mobile/node_modules/typescript');

// Exercise the installed Expo serializer, rather than Node's more permissive fetch.
function loadTs(relative, imports = {}, globals = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, Blob, FormData, AbortController, TextEncoder,
    Uint8Array, setTimeout, clearTimeout, ...globals,
    require(name) {
      if (!(name in imports)) throw new Error(`Unexpected dependency: ${name}`);
      return imports[name];
    },
  }, { filename });
  return module.exports;
}
const blobUtils = loadTs('mobile/node_modules/expo/src/utils/blobUtils.ts');
const { convertFormDataAsync } = loadTs('mobile/node_modules/expo/src/winter/fetch/convertFormData.ts', {
  '../../utils/blobUtils': blobUtils,
});
const { installFormDataPatch } = loadTs('mobile/node_modules/expo/src/winter/FormData.ts');
class NativeFormData { constructor() { this._parts = []; } }
installFormDataPatch(NativeFormData);

const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const config = { baseUrl: 'http://desktop.test:3000', token: 'paired-token' };
function fixture(platform, responseBody = { success: true, data: { id: 'attachment-1' } }) {
  const calls = [];
  class LocalFile {
    constructor(uri) {
      assert.equal(uri, 'file:///cache/photo.png');
      this.name = 'photo.png'; this.type = 'image/png';
    }
    async bytes() { return new Uint8Array(bytes); }
  }
  const { api } = loadTs('mobile/src/services/api.ts', {
    'expo/fetch': { fetch: async (url, init) => {
      if (url === 'blob:photo') return { blob: async () => new Blob([bytes], { type: 'image/png' }) };
      assert.equal(url, `${config.baseUrl}/api/v1/attachments`);
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer paired-token');
      assert.equal(init.headers['Content-Type'], undefined, 'fetch must generate the multipart boundary');
      assert.equal(init.signal.aborted, false);
      const encoded = await convertFormDataAsync(init.body);
      const decoded = await new Response(encoded.body, {
        headers: { 'Content-Type': `multipart/form-data; boundary=${encoded.boundary}` },
      }).formData();
      calls.push(decoded);
      return { ok: responseBody.success, json: async () => responseBody };
    } },
    'expo-file-system': { File: LocalFile },
    'react-native': { Platform: { OS: platform } },
  }, { FormData: platform === 'web' ? FormData : NativeFormData });
  return { api, calls };
}
function verifyUpload(form) {
  assert.equal(form.get('conversationId'), 'conversation-1');
  assert.equal(form.get('requestId'), 'stable-request-1');
  const file = form.get('image');
  assert.equal(file.type, 'image/png');
  return file.arrayBuffer().then(buffer => assert.deepEqual(Buffer.from(buffer), bytes));
}

test('Expo rejects the old URI-only file part', async () => {
  const form = new NativeFormData();
  form.append('image', { uri: 'file:///cache/photo.png', name: 'photo.png', type: 'image/png' });
  await assert.rejects(convertFormDataAsync(form), /Unsupported FormDataPart implementation/);
});

test('native photo upload serializes real file bytes with conversation and retry IDs', async () => {
  const { api, calls } = fixture('android');
  const image = { uri: 'file:///cache/photo.png', fileName: 'photo.png', mimeType: 'image/png' };
  for (let i = 0; i < 2; i++) {
    assert.equal((await api.uploadImage(config, image, 'conversation-1', 'stable-request-1')).id, 'attachment-1');
    await verifyUpload(calls[i]);
    assert.equal(calls[i].get('image').name, 'photo.png');
  }
});

test('web image picker File and URI fallback both upload binary images', async () => {
  const { api, calls } = fixture('web');
  const image = { uri: 'blob:photo', fileName: 'photo.png', file: new Blob([bytes], { type: 'image/png' }) };
  await api.uploadImage(config, image, 'conversation-1', 'stable-request-1');
  await api.uploadImage(config, { ...image, file: undefined }, 'conversation-1', 'stable-request-1');
  await Promise.all(calls.map(verifyUpload));
});

test('server validation errors remain visible to the user', async () => {
  const { api } = fixture('ios', { success: false, error: { message: 'Image exceeds the upload limit.' } });
  await assert.rejects(api.uploadImage(config, { uri: 'file:///cache/photo.png' }, 'conversation-1', 'stable-request-1'), /Image exceeds the upload limit/);
});

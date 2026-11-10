const { desktopCapturer, screen } = require('electron');
const logger = require('../core/logger').createServiceLogger('CAPTURE');
const readWindowMetadata = require('./capture-window-metadata.service');

const failure = (code, message) => Object.assign(new Error(message), { code });
const vmwareName = name => /\bvmware\b/i.test(name) && /\b(workstation|player)\b/i.test(name);
const vmwareExecutable = name => /^(vmware|vmplayer)\.exe$/i.test(name || '');
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

class CaptureService {
  constructor() { this.isProcessing = false; this.store = null; this.selected = null; this.readWindowMetadata = readWindowMetadata; this.withOverlaysHidden = async work => work(); }
  setOverlayCaptureScope(scope) { this.withOverlaysHidden = scope; }
  initialize(store) {
    this.store = store;
    try { this.selected = JSON.parse(store.getMeta('capture_target') || 'null'); } catch (_) { this.selected = null; }
  }
  persist(target) { this.selected = target; this.store?.setMeta('capture_target', JSON.stringify(target)); }
  listDisplays() {
    try { return { success: true, displays: screen.getAllDisplays().map(d => ({ id: d.id, bounds: d.bounds, size: d.size, scaleFactor: d.scaleFactor })) }; }
    catch (error) { return { success: false, error: error.message }; }
  }
  async enumerate(thumbnailSize = { width: 0, height: 0 }) {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize });
    let windows = [];
    try { windows = await this.readWindowMetadata(); } catch (error) { logger.warn('Window metadata unavailable', { error: error.message }); }
    return sources.filter(s => !(s.id.startsWith('window:') && /opencluely/i.test(s.name || ''))).map(source => {
      const handle = source.id.startsWith('window:') ? source.id.split(':')[1] : null;
      return { ...source, windowMetadata: handle ? windows.find(window => window.handle === handle) : undefined };
    });
  }
  isVmware(source) { return source.id.startsWith('window:') && (source.windowMetadata?.executable ? vmwareExecutable(source.windowMetadata.executable) : vmwareName(source.name || '')); }
  describe(source) {
    return source.id.startsWith('screen:')
      ? { kind: 'screen', displayId: source.display_id, displayName: source.name }
      : { kind: 'window', application: 'vmware', displayName: source.name, sourceId: source.id, ...(source.windowMetadata?.executable ? { executable: source.windowMetadata.executable } : {}) };
  }
  async listTargets() {
    const sources = await this.enumerate();
    return sources.filter(s => s.id.startsWith('screen:') || this.isVmware(s)).map(s => ({ ...this.describe(s), sourceId: s.id }));
  }
  async selectTarget(sourceId) {
    const source = (await this.enumerate()).find(s => s.id === sourceId && (s.id.startsWith('screen:') || this.isVmware(s)));
    if (!source) throw failure('TARGET_UNAVAILABLE', 'The selected target is unavailable. Refresh the target list.');
    const target = { ...this.describe(source), selectedAt: new Date().toISOString() };
    this.persist(target); return target;
  }
  setCrop(crop) {
    if (!this.selected) throw failure('TARGET_UNAVAILABLE', 'Select a target before setting a crop.');
    if (crop !== null && (!crop || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(crop[k])) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1 || crop.y + crop.height > 1)) throw failure('CAPTURE_FAILED', 'Crop percentages must fit inside the image.');
    this.persist({ ...this.selected, crop });
    return this.selected;
  }
  resolve(sources, requested = this.selected) {
    const windows = sources.filter(s => this.isVmware(s));
    if (!requested) {
      if (!windows.length) throw failure('NO_VM_WINDOW', 'No VMware Workstation or Player window was found. Open and restore VMware, or select a monitor explicitly.');
      if (windows.length > 1) throw failure('TARGET_SELECTION_REQUIRED', 'Multiple VMware windows were found. Select the desired target.');
      const target = { ...this.describe(windows[0]), selectedAt: new Date().toISOString() };
      this.persist(target); return windows[0];
    }
    if (requested.kind === 'screen') {
      const source = sources.find(s => s.id.startsWith('screen:') && String(s.display_id) === String(requested.displayId));
      if (!source) throw failure('TARGET_UNAVAILABLE', 'The selected monitor is unavailable. Select a new target.');
      return source;
    }
    if (requested.kind !== 'window' || requested.application !== 'vmware') throw failure('TARGET_UNAVAILABLE', 'The selected capture target is invalid. Select a new target.');
    const compatible = s => !requested.executable || !s.windowMetadata?.executable || requested.executable.toLowerCase() === s.windowMetadata.executable.toLowerCase();
    const exact = windows.find(s => s.id === requested.sourceId && compatible(s));
    if (exact) return exact;
    const sameName = windows.filter(s => s.name === requested.displayName && compatible(s));
    if (sameName.length === 1) return sameName[0];
    throw failure('TARGET_UNAVAILABLE', 'The selected VMware window is unavailable or ambiguous. Restore VMware and select it again.');
  }
  validateImage(image) {
    if (!image || image.isEmpty() || !image.getSize().width || !image.getSize().height) throw failure('EMPTY_CAPTURE', 'The target returned an empty image. Restore VMware and try again.');
    if (typeof image.toBitmap === 'function') {
      const pixels = image.toBitmap(); let hasVisibleColor = false;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] || pixels[i + 1] || pixels[i + 2]) { hasVisibleColor = true; break; }
      if (!hasVisibleColor) throw failure('EMPTY_CAPTURE', 'The target returned a black or transparent frame. Restore VMware and try again.');
    }
  }
  async captureVisibleFallback(requested, size) {
    if (!requested?.crop) throw failure('FALLBACK_CROP_REQUIRED', 'Window capture failed. Set a VMware viewport crop in phone Settings and retry, or restore the VMware window.');
    return this.withOverlaysHidden(async () => {
      const sources = await this.enumerate();
      const source = this.resolve(sources, requested);
      const window = source.windowMetadata;
      if (!window || !vmwareExecutable(window.executable) || window.minimized || !window.foreground) throw failure('TARGET_UNAVAILABLE', 'VMware must be restored and foreground for screen fallback.');
      const windows = await this.readWindowMetadata();
      const index = windows.findIndex(item => item.handle === window.handle);
      if (index < 0 || windows[index].minimized || !windows[index].foreground) throw failure('TARGET_UNAVAILABLE', 'VMware is no longer visible. Restore it and retry.');
      const bounds = windows[index];
      if (windows.slice(0, index).some(other => !other.minimized && overlaps(bounds, other))) throw failure('TARGET_OCCLUDED', 'Another window covers VMware. Bring VMware to the foreground and retry.');
      const displays = screen.getAllDisplays();
      const physical = displays.map(display => ({ display, bounds: screen.dipToScreenRect(null, display.bounds) }));
      const matches = physical.filter(({ bounds: b }) => bounds.x >= b.x && bounds.y >= b.y && bounds.x + bounds.width <= b.x + b.width && bounds.y + bounds.height <= b.y + b.height);
      if (matches.length !== 1) throw failure('TARGET_UNAVAILABLE', 'VMware must fit entirely on one display for screen fallback.');
      const { display, bounds: displayBounds } = matches[0];
      const screens = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
      const monitor = screens.find(item => String(item.display_id) === String(display.id));
      if (!monitor) throw failure('TARGET_UNAVAILABLE', 'The VMware display is unavailable for fallback capture.');
      this.validateImage(monitor.thumbnail);
      const actual = monitor.thumbnail.getSize();
      const sx = actual.width / displayBounds.width; const sy = actual.height / displayBounds.height;
      const left = Math.round((bounds.x - displayBounds.x) * sx); const top = Math.round((bounds.y - displayBounds.y) * sy);
      const right = Math.round((bounds.x + bounds.width - displayBounds.x) * sx); const bottom = Math.round((bounds.y + bounds.height - displayBounds.y) * sy);
      if (left < 0 || top < 0 || right > actual.width || bottom > actual.height || right <= left || bottom <= top) throw failure('TARGET_UNAVAILABLE', 'VMware bounds could not be mapped to the selected display.');
      const image = monitor.thumbnail.crop({ x: left, y: top, width: right - left, height: bottom - top });
      this.validateImage(image);
      const after = await this.readWindowMetadata(); const afterIndex = after.findIndex(item => item.handle === bounds.handle);
      const current = after[afterIndex];
      if (!current || current.minimized || !current.foreground || ['x', 'y', 'width', 'height'].some(key => current[key] !== bounds[key]) || after.slice(0, afterIndex).some(other => !other.minimized && overlaps(current, other))) throw failure('TARGET_UNAVAILABLE', 'VMware moved or became obscured during capture. Restore it and retry.');
      const target = { ...requested, ...this.describe(source), lastValidatedAt: new Date().toISOString() };
      this.persist(target);
      return { image, metadata: { target, method: 'visible-screen-fallback', displayId: display.id, dimensions: image.getSize(), captureTime: new Date().toISOString() } };
    });
  }
  async captureAndProcess(options = {}) {
    if (this.isProcessing) throw failure('CAPTURE_FAILED', 'Capture already in progress.');
    this.isProcessing = true;
    try {
      const result = await this.captureScreenshot(options);
      let image = result.image;
      const size = image.getSize(); const crop = this.selected?.crop;
      const area = options.area || (crop && { x: Math.round(crop.x * size.width), y: Math.round(crop.y * size.height), width: Math.min(size.width - Math.round(crop.x * size.width), Math.round(crop.width * size.width)), height: Math.min(size.height - Math.round(crop.y * size.height), Math.round(crop.height * size.height)) });
      if (area) {
        if (![area.x, area.y, area.width, area.height].every(Number.isInteger) || area.x < 0 || area.y < 0 || area.width <= 0 || area.height <= 0 || area.x + area.width > size.width || area.y + area.height > size.height) throw failure('CAPTURE_FAILED', 'The crop region is outside the captured image.');
        image = image.crop(area);
      }
      const imageBuffer = image.toPNG();
      if (!imageBuffer?.length || image.isEmpty()) throw failure('EMPTY_CAPTURE', 'The capture was empty. Restore VMware and try again.');
      return { imageBuffer, mimeType: 'image/png', metadata: { timestamp: new Date().toISOString(), source: result.metadata, dimensions: image.getSize() } };
    } finally { this.isProcessing = false; }
  }
  async captureScreenshot(options = {}) {
    const displays = screen.getAllDisplays();
    if (!displays.length) throw failure('NO_CAPTURE_SOURCE', 'No host displays are available.');
    const size = { width: Math.max(...displays.map(d => Math.ceil(d.size.width * d.scaleFactor))), height: Math.max(...displays.map(d => Math.ceil(d.size.height * d.scaleFactor))) };
    const requested = options.target || (options.displayId != null ? { kind: 'screen', displayId: options.displayId } : this.selected);
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const sources = await this.enumerate(size);
        if (!sources.length) throw failure('NO_CAPTURE_SOURCE', 'No capture sources are available.');
        const source = this.resolve(sources, requested || this.selected);
        const image = source.thumbnail;
        this.validateImage(image);
        const target = { ...(requested || this.selected || this.describe(source)), ...this.describe(source), lastValidatedAt: new Date().toISOString() };
        this.persist(target);
        logger.debug('Capture completed', { kind: target.kind, dimensions: image.getSize() });
        return { image, metadata: { target, dimensions: image.getSize(), captureTime: new Date().toISOString() } };
      } catch (error) { lastError = error; }
    }
    const target = requested || this.selected;
    if (target?.kind === 'window' && (!lastError?.code || lastError.code === 'EMPTY_CAPTURE' || lastError.code === 'CAPTURE_FAILED')) return this.captureVisibleFallback(target, size);
    if (lastError?.code) throw lastError;
    throw failure('CAPTURE_FAILED', `Capture failed: ${lastError?.message || 'unknown error'}. Restore the target and try again.`);
  }
}
module.exports = new CaptureService();

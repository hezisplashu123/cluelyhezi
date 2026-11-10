const { randomUUID } = require('crypto');
// Serialize captures so quick repeated key presses each produce an image.
class ScreenshotQueue {
  constructor(capture, onChange = () => {}) {
    this.capture = capture;
    this.onChange = onChange;
    this.images = [];
    this.tail = Promise.resolve();
    this.submitting = false;
  }

  add(options) {
    const task = this.tail.then(async () => {
      if (this.images.length >= 20) throw new Error('Screenshot queue is full (20). Submit or clear it first.');
      const image = await this.capture(options);
      if (!image.imageBuffer?.length) throw new Error('Screenshot was empty.');
      const bytes = this.images.reduce((sum, item) => sum + item.imageBuffer.length, 0);
      if (bytes + image.imageBuffer.length > 150 * 1024 * 1024) throw new Error('Screenshot queue is full. Submit or clear it first.');
      image.id = randomUUID();
      image.createdAt = new Date().toISOString();
      this.images.push(image);
      this.onChange(this.images.length);
      return { id: image.id, createdAt: image.createdAt, mimeType: image.mimeType, metadata: image.metadata, count: this.images.length };
    });
    this.tail = task.catch(() => {});
    return task;
  }

  async submit(analyze) {
    if (this.submitting) return { success: false, busy: true };
    this.submitting = true;
    let batch = [];
    try {
      await this.tail;
      batch = this.images.slice();
      if (!batch.length) throw new Error('No screenshots queued. Capture a screenshot first.');
      await analyze(batch);
      const submitted = new Set(batch.map(item => item.id));
      this.images = this.images.filter(item => !submitted.has(item.id));
      this.onChange(this.images.length);
      return { success: true, count: batch.length };
    } catch (error) {
      throw error;
    } finally {
      this.submitting = false;
    }
  }

  async clear() {
    if (this.submitting) return { success: false, busy: true, error: 'A screenshot submission is in progress.' };
    await this.tail;
    if (this.submitting) return { success: false, busy: true, error: 'A screenshot submission is in progress.' };
    const count = this.images.length;
    this.images = [];
    this.onChange(0);
    return { success: true, cleared: count, count: 0 };
  }
}

module.exports = ScreenshotQueue;

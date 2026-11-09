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
      this.images.push(image);
      this.onChange(this.images.length);
      return this.images.length;
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
      batch = this.images.splice(0);
      this.onChange(this.images.length);
      if (!batch.length) throw new Error('No screenshots queued. Press \\ to capture first.');
      await analyze(batch);
      return { success: true, count: batch.length };
    } catch (error) {
      this.images.unshift(...batch);
      this.onChange(this.images.length);
      throw error;
    } finally {
      this.submitting = false;
    }
  }
}

module.exports = ScreenshotQueue;

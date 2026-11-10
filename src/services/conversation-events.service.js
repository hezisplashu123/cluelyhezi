const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');

class ConversationEvents extends EventEmitter {
  constructor() {
    super();
    this.sequence = 0;
    this.buffer = [];
    this.maxBuffered = 500;
  }

  publish(type, payload = {}) {
    const event = {
      id: randomUUID(),
      sequence: ++this.sequence,
      type,
      timestamp: new Date().toISOString(),
      payload
    };
    this.buffer.push(event);
    if (this.buffer.length > this.maxBuffered) this.buffer.shift();
    this.emit('event', event);
    return event;
  }

  since(sequence = 0) {
    const value = Number(sequence) || 0;
    return this.buffer.filter(event => event.sequence > value);
  }
}

module.exports = new ConversationEvents();

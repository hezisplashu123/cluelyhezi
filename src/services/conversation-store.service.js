const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const now = () => new Date().toISOString();
const json = value => value == null ? null : JSON.stringify(value);
const parseJson = value => {
  if (!value) return null;
  try { return JSON.parse(value); } catch (_) { return null; }
};

class ConversationStore {
  constructor() {
    this.db = null;
    this.root = null;
    this.captureDir = null;
    this.currentConversationId = null;
  }

  initialize(userDataPath) {
    if (this.db) return this.getStatus();
    this.root = path.join(userDataPath, 'conversations');
    this.captureDir = path.join(this.root, 'captures');
    fs.mkdirSync(this.captureDir, { recursive: true });
    const dbPath = path.join(this.root, 'history.sqlite');
    this.dbPath = dbPath;
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.migrate();
    this.currentConversationId = this.getMeta('current_conversation_id');
    if (!this.currentConversationId || !this.getConversation(this.currentConversationId)) {
      this.currentConversationId = this.createConversation({ title: 'Conversation' }).id;
    }
    this.markInterrupted();
    return this.getStatus();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS conversations(
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        title TEXT, skill TEXT, metadata_json TEXT
      );
      CREATE TABLE IF NOT EXISTS messages(
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, turn_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
        source TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, status TEXT NOT NULL, related_message_id TEXT,
        original_message_id TEXT, model TEXT, skill TEXT, context_mode TEXT,
        error TEXT, metadata_json TEXT,
        FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS attachments(
        id TEXT PRIMARY KEY, message_id TEXT NOT NULL, local_path TEXT NOT NULL,
        mime_type TEXT NOT NULL, size INTEGER NOT NULL, content_hash TEXT,
        created_at TEXT NOT NULL, metadata_json TEXT,
        FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS idempotency(
        request_id TEXT PRIMARY KEY, kind TEXT NOT NULL, response_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_time ON messages(conversation_id, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_messages_turn ON messages(turn_id);
      CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, datetime('now'));
    `);
  }

  markInterrupted() {
    this.db.prepare(`UPDATE messages SET status='interrupted', updated_at=?
      WHERE role='assistant' AND status IN ('pending','streaming')`).run(now());
  }

  getMeta(key) { return this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value || null; }
  setMeta(key, value) {
    this.db.prepare('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
  }

  createConversation({ title = 'Conversation', skill = null, metadata = null } = {}) {
    const id = crypto.randomUUID();
    const timestamp = now();
    this.db.prepare('INSERT INTO conversations(id,created_at,updated_at,title,skill,metadata_json) VALUES(?,?,?,?,?,?)')
      .run(id, timestamp, timestamp, title, skill, json(metadata));
    this.currentConversationId = id;
    this.setMeta('current_conversation_id', id);
    return this.getConversation(id);
  }

  getConversation(id) {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id=?').get(id);
    return row ? this.mapConversation(row) : null;
  }

  listConversations({ limit = 50, cursor = null } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const rows = cursor
      ? this.db.prepare('SELECT * FROM conversations WHERE updated_at < ? ORDER BY updated_at DESC LIMIT ?').all(cursor, safeLimit + 1)
      : this.db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?').all(safeLimit + 1);
    const more = rows.length > safeLimit;
    const items = rows.slice(0, safeLimit).map(row => this.mapConversation(row));
    return { items, nextCursor: more ? items[items.length - 1].updatedAt : null };
  }

  createTurn({ conversationId = this.currentConversationId, source, content, skill = null,
    originalMessageId = null, contextMode = null, metadata = null } = {}) {
    const turnId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    const timestamp = now();
    const assistantTimestamp = new Date(Date.now() + 1).toISOString();
    this.transaction(() => {
      this.db.prepare(`INSERT INTO messages(id,conversation_id,turn_id,role,source,content,created_at,updated_at,status,original_message_id,skill,context_mode,metadata_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(userId, conversationId, turnId, 'user', source, content, timestamp, timestamp, 'completed', originalMessageId, skill, contextMode, json(metadata));
      this.db.prepare(`INSERT INTO messages(id,conversation_id,turn_id,role,source,content,created_at,updated_at,status,related_message_id,original_message_id,skill,context_mode,metadata_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(assistantId, conversationId, turnId, 'assistant', source, '', assistantTimestamp, assistantTimestamp, 'pending', userId, originalMessageId, skill, contextMode, json(metadata));
      this.db.prepare('UPDATE messages SET related_message_id=? WHERE id=?').run(assistantId, userId);
      this.db.prepare('UPDATE conversations SET updated_at=?, skill=COALESCE(?,skill) WHERE id=?').run(timestamp, skill, conversationId);
    });
    return { turnId, user: this.getMessage(userId), assistant: this.getMessage(assistantId) };
  }

  appendAssistant(id, delta) {
    this.db.prepare(`UPDATE messages SET content=content || ?, status='streaming', updated_at=? WHERE id=? AND role='assistant'`).run(String(delta), now(), id);
    return this.getMessage(id);
  }

  completeAssistant(id, content, metadata = null) {
    this.db.prepare(`UPDATE messages SET content=?, status='completed', updated_at=?, model=COALESCE(?,model), metadata_json=COALESCE(?,metadata_json), error=NULL WHERE id=? AND role='assistant'`)
      .run(String(content || ''), now(), metadata?.model || null, json(metadata), id);
    return this.getMessage(id);
  }

  failAssistant(id, error, content = null) {
    this.db.prepare(`UPDATE messages SET content=CASE WHEN ? IS NULL THEN content ELSE ? END,
      status='failed', error=?, updated_at=? WHERE id=? AND role='assistant'`)
      .run(content, content, String(error || 'Unknown error'), now(), id);
    return this.getMessage(id);
  }

  addAttachments(messageId, captures) {
    const insert = this.db.prepare(`INSERT INTO attachments(id,message_id,local_path,mime_type,size,content_hash,created_at,metadata_json)
      VALUES(?,?,?,?,?,?,?,?)`);
    const result = [];
    this.transaction(() => {
      for (const capture of captures) {
        const id = crypto.randomUUID();
        const mimeType = capture.mimeType || 'image/png';
        const extension = mimeType === 'image/jpeg' ? '.jpg' : '.png';
        const target = path.join(this.captureDir, `${id}${extension}`);
        fs.writeFileSync(target, capture.imageBuffer, { flag: 'wx' });
        const hash = crypto.createHash('sha256').update(capture.imageBuffer).digest('hex');
        insert.run(id, messageId, target, mimeType, capture.imageBuffer.length, hash, now(), json(capture.metadata));
        result.push({ id, messageId, localPath: target, mimeType, size: capture.imageBuffer.length, contentHash: hash });
      }
    });
    return result;
  }

  loadAttachments(messageId) {
    const rows = this.db.prepare('SELECT * FROM attachments WHERE message_id=? ORDER BY created_at,id').all(messageId);
    return rows.map(row => ({
      id: row.id, messageId: row.message_id, localPath: row.local_path,
      mimeType: row.mime_type, size: row.size, contentHash: row.content_hash,
      metadata: parseJson(row.metadata_json), exists: fs.existsSync(row.local_path)
    }));
  }

  getMessage(id) {
    const row = this.db.prepare('SELECT * FROM messages WHERE id=?').get(id);
    return row ? this.mapMessage(row) : null;
  }

  getMessages(conversationId, { limit = 30, cursor = null } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
    const rows = cursor?.rowid
      ? this.db.prepare('SELECT rowid AS message_rowid,* FROM messages WHERE conversation_id=? AND rowid < ? ORDER BY rowid DESC LIMIT ?').all(conversationId, cursor.rowid, safeLimit + 1)
      : this.db.prepare('SELECT rowid AS message_rowid,* FROM messages WHERE conversation_id=? ORDER BY rowid DESC LIMIT ?').all(conversationId, safeLimit + 1);
    const more = rows.length > safeLimit;
    const selected = rows.slice(0, safeLimit);
    const oldest = selected[selected.length - 1];
    return {
      items: selected.reverse().map(row => this.mapMessage(row)),
      nextCursor: more && oldest ? Buffer.from(JSON.stringify({ rowid: oldest.message_rowid })).toString('base64url') : null
    };
  }

  decodeCursor(cursor) {
    if (!cursor) return null;
    try { return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch (_) { return null; }
  }

  getIdempotent(requestId, kind) {
    if (!requestId) return null;
    const row = this.db.prepare('SELECT response_json FROM idempotency WHERE request_id=? AND kind=?').get(requestId, kind);
    return row ? parseJson(row.response_json) : null;
  }

  saveIdempotent(requestId, kind, response) {
    if (!requestId) return;
    this.db.prepare('INSERT OR IGNORE INTO idempotency(request_id,kind,response_json,created_at) VALUES(?,?,?,?)')
      .run(requestId, kind, json(response), now());
  }

  getStatus() {
    return { databasePath: this.db ? this.dbPath : null, capturePath: this.captureDir, currentConversationId: this.currentConversationId };
  }

  getStorageUsage() {
    const row = this.db.prepare('SELECT COALESCE(SUM(size),0) AS attachment_bytes, COUNT(*) AS attachment_count FROM attachments').get();
    const dbBytes = this.db && fs.existsSync(this.dbPath) ? fs.statSync(this.dbPath).size : 0;
    return { databaseBytes: dbBytes, attachmentBytes: row.attachment_bytes, attachmentCount: row.attachment_count };
  }

  deleteAllHistory() {
    this.transaction(() => {
      this.db.prepare('DELETE FROM conversations').run();
      this.db.prepare('DELETE FROM idempotency').run();
    });
    for (const entry of fs.readdirSync(this.captureDir, { withFileTypes: true })) {
      if (entry.isFile()) fs.unlinkSync(path.join(this.captureDir, entry.name));
    }
    this.currentConversationId = null;
    return this.createConversation({ title: 'Conversation' });
  }

  mapConversation(row) {
    return { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at, title: row.title, skill: row.skill, metadata: parseJson(row.metadata_json) };
  }

  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  mapMessage(row) {
    const attachmentCount = this.db.prepare('SELECT COUNT(*) AS count FROM attachments WHERE message_id=?').get(row.id).count;
    return {
      id: row.id, conversationId: row.conversation_id, turnId: row.turn_id,
      role: row.role, source: row.source, content: row.content,
      createdAt: row.created_at, updatedAt: row.updated_at, status: row.status,
      relatedMessageId: row.related_message_id, originalMessageId: row.original_message_id,
      model: row.model, skill: row.skill, contextMode: row.context_mode,
      error: row.error, metadata: parseJson(row.metadata_json), attachmentCount
    };
  }

  close() {
    if (!this.db) return;
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.db.close();
    this.db = null;
  }
}

module.exports = new ConversationStore();

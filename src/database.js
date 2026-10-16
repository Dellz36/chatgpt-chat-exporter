import { DatabaseSync } from "node:sqlite";

export function openDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  const prepare = db.prepare.bind(db);
  db.prepare = sql => {
    const statement = prepare(sql);
    statement.setAllowUnknownNamedParameters(true);
    return statement;
  };
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, project TEXT, archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT, updated_at TEXT, json_path TEXT NOT NULL, markdown_path TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      conversation_id TEXT NOT NULL, message_index INTEGER NOT NULL, role TEXT, author TEXT,
      created_at TEXT, content_type TEXT, body TEXT,
      PRIMARY KEY (conversation_id, message_index),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
      conversation_id UNINDEXED, title, project, role, body,
      tokenize = 'unicode61'
    );
  `);
  return db;
}

export function indexConversation(db, conversation, jsonPath, markdownPath) {
  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO conversations (id,title,project,archived,created_at,updated_at,json_path,markdown_path)
      VALUES (@id,@title,@project,@archived,@created_at,@updated_at,@jsonPath,@markdownPath)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,project=excluded.project,
      archived=excluded.archived,created_at=excluded.created_at,updated_at=excluded.updated_at,
      json_path=excluded.json_path,markdown_path=excluded.markdown_path
    `).run({ ...conversation, archived: conversation.archived ? 1 : 0, jsonPath, markdownPath });
    db.prepare("DELETE FROM messages WHERE conversation_id=?").run(conversation.id);
    db.prepare("DELETE FROM search_fts WHERE conversation_id=?").run(conversation.id);
    const insertMessage = db.prepare(`
      INSERT INTO messages VALUES (@conversation_id,@message_index,@role,@author,@created_at,@content_type,@body)
    `);
    const insertFts = db.prepare(`
      INSERT INTO search_fts(conversation_id,title,project,role,body) VALUES (?,?,?,?,?)
    `);
    for (const message of conversation.messages) {
      insertMessage.run({
        conversation_id: conversation.id, message_index: message.index, role: message.role,
        author: message.author, created_at: message.created_at, content_type: message.content_type,
        body: message.text
      });
      insertFts.run(conversation.id, conversation.title, conversation.project, message.role, message.text);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

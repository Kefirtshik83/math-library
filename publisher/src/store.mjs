// SQLite values support long articles; DO key-value values have a smaller size limit.
export class StateStore {
  constructor(ctx) {this.ctx=ctx;this.sql=ctx.storage.sql;this.sql.exec('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');}
  async get(key) {const rows=this.sql.exec('SELECT value FROM state WHERE key = ?',key).toArray();return rows.length?JSON.parse(rows[0].value):undefined;}
  async put(key,value) {this.sql.exec('INSERT INTO state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,JSON.stringify(value));}
  async delete(key) {this.sql.exec('DELETE FROM state WHERE key = ?',key);}
  async list() {return new Map(this.sql.exec('SELECT key,value FROM state').toArray().map(r=>[r.key,JSON.parse(r.value)]));}
  // All callbacks contain local SQL only, never network calls. blockConcurrencyWhile
  // prevents interleaving across awaits, including OAuth/review one-time consumption.
  async transaction(callback) {
    let failure;
    const value=await this.ctx.blockConcurrencyWhile(async()=>{try{return await callback(this);}catch(e){failure=e;}});
    if(failure)throw failure;
    return value;
  }
}

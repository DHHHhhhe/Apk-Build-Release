import Database from 'better-sqlite3'

const db = new Database('apps/desktop/app-dev.db', { readonly: true })
const tables = db
  .prepare("select name from sqlite_master where type = 'table' order by name")
  .all()
  .map((row) => row.name)
console.log('tables: ' + tables.join(', '))
db.close()

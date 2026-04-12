// Type stub for optional better-sqlite3 dependency
declare module 'better-sqlite3' {
  interface Statement {
    all(...params: unknown[]): unknown[]
    get(...params: unknown[]): unknown
    run(...params: unknown[]): unknown
  }

  interface Database {
    prepare(sql: string): Statement
    close(): void
  }

  interface DatabaseConstructor {
    new (filename: string, options?: { readonly?: boolean }): Database
  }

  const Database: DatabaseConstructor
  export default Database
}

export interface PostgresQueryResult<TRow> {
  rows: TRow[];
  rowCount: number | null;
}

export interface PostgresQueryable {
  query<TRow = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<PostgresQueryResult<TRow>>;
  withTransaction<TResult>(fn: (tx: PostgresQueryable) => Promise<TResult>): Promise<TResult>;
}

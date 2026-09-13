import { describe, expect, test } from 'bun:test';
import { fetchAllPages, POSTGREST_PAGE_SIZE } from './paged-fetch';

/** A fake table of N rows that answers inclusive ranges the way PostgREST does. */
const table = (n: number, cap = POSTGREST_PAGE_SIZE) => {
  const all = Array.from({ length: n }, (_v, i) => i);
  const calls: Array<[number, number]> = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    // PostgREST truncates any range wider than max-rows, silently.
    const end = Math.min(to, from + cap - 1);
    return all.slice(from, end + 1);
  };
  return { fetchPage, calls };
};

describe('fetchAllPages — reading past the PostgREST row cap', () => {
  test('a single short page needs exactly one request', async () => {
    const t = table(42);
    expect((await fetchAllPages(t.fetchPage)).length).toBe(42);
    expect(t.calls.length).toBe(1);
  });

  // The regression: 1432 jobs, a 1000-row cap, and no error to tell you 432 went missing.
  test('1432 rows behind a 1000-row cap come back complete', async () => {
    const t = table(1432);
    const rows = await fetchAllPages(t.fetchPage);
    expect(rows.length).toBe(1432);
    expect(rows[0]).toBe(0);
    expect(rows[1431]).toBe(1431);
  });

  test('an exact multiple of the page size still terminates', async () => {
    const t = table(2000);
    expect((await fetchAllPages(t.fetchPage)).length).toBe(2000);
    expect(t.calls.length).toBe(3); // 1000, 1000, then an empty page proves the end
  });

  test('empty table, one request, no rows', async () => {
    const t = table(0);
    expect(await fetchAllPages(t.fetchPage)).toEqual([]);
    expect(t.calls.length).toBe(1);
  });

  test('a limit is honoured exactly and costs no extra requests', async () => {
    const t = table(5000);
    const rows = await fetchAllPages(t.fetchPage, { limit: 1500 });
    expect(rows.length).toBe(1500);
    expect(t.calls.length).toBe(2);
    expect(t.calls[1]).toEqual([1000, 1499]); // second page trimmed to what is still needed
  });

  test('a limit smaller than one page is a single trimmed request', async () => {
    const t = table(5000);
    expect((await fetchAllPages(t.fetchPage, { limit: 50 })).length).toBe(50);
    expect(t.calls).toEqual([[0, 49]]);
  });

  test('offset starts where the caller asked', async () => {
    const t = table(1200);
    const rows = await fetchAllPages(t.fetchPage, { offset: 1000 });
    expect(rows.length).toBe(200);
    expect(rows[0]).toBe(1000);
  });

  test('maxPages stops a server that never returns a short page', async () => {
    // Pathological: always answers with a full page, so only the safety valve ends the loop.
    let calls = 0;
    const never = async (from: number, to: number) => {
      calls += 1;
      return Array.from({ length: to - from + 1 }, (_v, i) => from + i);
    };
    const rows = await fetchAllPages(never, { pageSize: 10, maxPages: 5 });
    expect(calls).toBe(5);
    expect(rows.length).toBe(50);
  });
});

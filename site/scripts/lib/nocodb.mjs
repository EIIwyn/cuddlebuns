export const BATCH_SIZE = 10;
const PAGE_SIZE = 100;

export function chunkByBatch(items) {
  const chunks = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) chunks.push(items.slice(i, i + BATCH_SIZE));
  return chunks;
}

export function createNocodbClient({ url, token, baseId, fetchImpl = globalThis.fetch, timeoutMs = 120_000 }) {
  const base = String(url).replace(/\/+$/, '');
  const headers = { 'xc-token': token, 'content-type': 'application/json' };

  async function request(method, pathname, { body, label }) {
    const target = new URL(pathname, `${base}/`);
    const response = await fetchImpl(target, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`${label} request failed: ${response.status} ${response.statusText}`);
    return response.json();
  }

  function dataPath(tableId, suffix = '') {
    return `/api/v3/data/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}/records${suffix}`;
  }

  return {
    async fetchAllRecords(tableId, label) {
      const records = [];
      let next = `${dataPath(tableId)}?pageSize=${PAGE_SIZE}&linksAsLtar=true`;
      while (next) {
        // NocoDB may return absolute `next` URLs for its internal host; keep only path + query.
        const returned = new URL(next, `${base}/`);
        const page = await request('GET', `${returned.pathname}${returned.search}`, { label });
        records.push(...(page.records ?? []).map((record) => ({ ...record, id: String(record.id) })));
        next = page.next ?? null;
      }
      return records;
    },

    async getTableMeta(tableId) {
      const meta = await request('GET', `/api/v2/meta/tables/${encodeURIComponent(tableId)}`, { label: 'Table metadata' });
      return {
        columns: (meta.columns ?? []).map((column) => ({
          id: column.id, title: column.title, uidt: column.uidt,
          options: Array.isArray(column.colOptions?.options) ? column.colOptions.options.map((option) => option.title) : null,
          relatedTableId: column.colOptions?.fk_related_model_id ?? null,
        })),
      };
    },

    async createRecords(tableId, fieldsList) {
      const created = [];
      for (const batch of chunkByBatch(fieldsList)) {
        const result = await request('POST', dataPath(tableId), { body: batch.map((fields) => ({ fields })), label: 'Create records' });
        created.push(...(result.records ?? []).map((record) => ({ id: String(record.id) })));
      }
      return created;
    },

    async updateRecords(tableId, updates) {
      for (const batch of chunkByBatch(updates)) {
        await request('PATCH', dataPath(tableId), { body: batch.map(({ id, fields }) => ({ id, fields })), label: 'Update records' });
      }
    },

    async linkRecords(tableId, linkFieldId, recordId, targetIds) {
      if (!targetIds.length) return;
      await request('POST', `/api/v3/data/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}/links/${encodeURIComponent(linkFieldId)}/${encodeURIComponent(recordId)}`, { body: targetIds.map((id) => ({ id: String(id) })), label: 'Link records' });
    },

    async unlinkRecords(tableId, linkFieldId, recordId, targetIds) {
      if (!targetIds.length) return;
      await request('DELETE', `/api/v3/data/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}/links/${encodeURIComponent(linkFieldId)}/${encodeURIComponent(recordId)}`, { body: targetIds.map((id) => ({ id: String(id) })), label: 'Unlink records' });
    },
  };
}

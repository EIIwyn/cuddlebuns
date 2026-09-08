function encodePath(value) {
  return encodeURIComponent(String(value))
}

function redact(value, secrets) {
  let result = String(value)
  for (const secret of secrets.filter(Boolean)) result = result.split(secret).join('[REDACTED]')
  return result
}

export function createPocketBaseClient(config, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 30_000
  const maxReadAttempts = options.maxReadAttempts ?? 3
  let authToken = null
  let fileToken = null

  function urlFor(pathname, query = {}) {
    const url = new URL(pathname, `${config.url}/`)
    for (const [key, value] of Object.entries(query)) {
      if (value != null && value !== '') url.searchParams.set(key, String(value))
    }
    return url
  }

  async function parseResponse(response) {
    const text = await response.text()
    if (!text) return null
    try { return JSON.parse(text) } catch { return text }
  }

  async function failure(response, payload) {
    const detail = typeof payload === 'string' ? payload : payload?.message ?? JSON.stringify(payload)
    const message = redact(`PocketBase request failed: ${response.status} ${detail}`, [config.password, authToken])
    const error = new Error(message)
    error.status = response.status
    return error
  }

  async function send(url, init) {
    const signal = init.signal ?? AbortSignal.timeout(timeoutMs)
    return fetchImpl(url, { ...init, signal })
  }

  async function authenticate(force = false) {
    if (authToken && !force) return authToken
    const url = urlFor(`/api/collections/${encodePath(config.authCollection)}/auth-with-password`)
    const response = await send(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: config.identity, password: config.password }),
    })
    const payload = await parseResponse(response)
    if (!response.ok || !payload?.token) throw await failure(response, payload)
    authToken = payload.token
    return authToken
  }

  async function request(method, pathname, { query, body, retryAuth = true } = {}) {
    await authenticate()
    const headers = { Authorization: authToken }
    let requestBody = body
    if (body != null && !(body instanceof FormData)) {
      headers['content-type'] = 'application/json'
      requestBody = JSON.stringify(body)
    }
    let response
    const attempts = method === 'GET' ? maxReadAttempts : 1
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        response = await send(urlFor(pathname, query), { method, headers, body: requestBody })
      } catch (error) {
        if (attempt === attempts) throw new Error(redact(`PocketBase request failed: ${error.message}`, [config.password, authToken]))
        continue
      }
      if (![408, 425, 429].includes(response.status) && response.status < 500) break
      if (attempt === attempts) break
    }
    if (response.status === 401 && retryAuth) {
      await authenticate(true)
      headers.Authorization = authToken
      response = await send(urlFor(pathname, query), { method, headers, body: requestBody })
    }
    const payload = await parseResponse(response)
    if (!response.ok) throw await failure(response, payload)
    return payload
  }

  const client = {
    async listAll(collection, options = {}) {
      const records = []
      let page = 1
      let totalPages = 1
      do {
        const result = await request('GET', `/api/collections/${encodePath(collection)}/records`, {
          query: {
            page,
            perPage: options.perPage ?? 200,
            filter: options.filter,
            sort: options.sort,
            expand: options.expand,
            fields: options.fields,
          },
        })
        records.push(...(result.items ?? []))
        totalPages = result.totalPages ?? 1
        page += 1
      } while (page <= totalPages)
      return records
    },

    async getByLegacyId(collection, legacyId) {
      const records = await this.listAll(collection, { filter: `legacy_id = ${Number(legacyId)}`, perPage: 2 })
      if (records.length > 1) throw new Error(`Duplicate legacy_id ${legacyId} in ${collection}`)
      return records[0] ?? null
    },

    async getFileToken() {
      const result = await request('POST', '/api/files/token', { retryAuth: true })
      return result.token
    },

    fileUrl(collection, recordId, filename, token) {
      return urlFor(`/api/files/${encodePath(collection)}/${encodePath(recordId)}/${encodePath(filename)}`, { token }).href
    },

    async downloadFile(collection, record, filename) {
      fileToken ??= await this.getFileToken()
      let response = await send(this.fileUrl(collection, record.id, filename, fileToken), { method: 'GET' })
      // Protected files deliberately use 404 for invalid or expired file tokens.
      if ([401, 403, 404].includes(response.status)) {
        fileToken = await this.getFileToken()
        response = await send(this.fileUrl(collection, record.id, filename, fileToken), { method: 'GET' })
      }
      if (!response.ok) throw new Error(`PocketBase file request failed: ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    },
  }

  if (config.role === 'migration') {
    client.createRecord = (collection, body) => request(
      'POST', `/api/collections/${encodePath(collection)}/records`, { body, retryAuth: false })
    client.updateRecord = (collection, recordId, body) => request(
      'PATCH', `/api/collections/${encodePath(collection)}/records/${encodePath(recordId)}`, { body, retryAuth: false })
  }

  return Object.freeze(client)
}

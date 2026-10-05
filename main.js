export default {
    async fetch(request, env, ctx) {
        const startedAt = Date.now()
        const method = request.method
        const route = getSafeRoute(request, env.ROOT_PATH || '/')
        const response = await handleRequest(request, env, ctx)

        console.log(JSON.stringify({
            event: 'request',
            method,
            route,
            status: response.status,
            duration_ms: Date.now() - startedAt,
        }))

        return response
    }
}

function getSafeRoute(request, rootPath) {
    const pathname = new URL(request.url).pathname
    const escapedRootPath = rootPath.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
    const realPathname = pathname.replace(new RegExp('^' + escapedRootPath), '/')

    if (['/register', '/ping', '/healthz', '/info'].includes(realPathname)) {
        return realPathname
    }

    if (realPathname === '/admin' || realPathname.startsWith('/admin/')) {
        return '/admin'
    }

    if (realPathname === '/mcp' || realPathname.startsWith('/mcp/')) {
        return '/mcp'
    }

    return '/push'
}

async function handleRequest(request, env, ctx) {
    const allowQueryNums = env.ALLOW_QUERY_NUMS !== undefined ? (env.ALLOW_QUERY_NUMS === 'false' ? false : Boolean(env.ALLOW_QUERY_NUMS)) : true
    const rootPath = env.ROOT_PATH || '/'
    const basicAuth = env.BASIC_AUTH

    const db = new Database(env)
    ctx.waitUntil(db.cleanupExpiredSessions())

    const { searchParams, pathname } = new URL(request.url)
    const handler = new Handler(db, { allowQueryNums })
    const realPathname = pathname.replace((new RegExp('^' + rootPath.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'))), '/')

    if (realPathname === '/admin' || realPathname.startsWith('/admin/')) {
        if (new URL(request.url).hostname !== 'bark.cedrat.im') {
            return new Response('Not Found', { status: 404 })
        }

        if (realPathname === '/admin' || realPathname === '/admin/') {
            return handleAdminPage(request)
        }

        if (realPathname === '/admin/api/status' || realPathname === '/admin/api/registration' || realPathname === '/admin/api/device-note') {
            return handleAdminApi(request, db, realPathname)
        }

        return new Response('Not Found', { status: 404 })
    }

    switch (realPathname) {
        case '/register': {
            return handler.register(searchParams)
        }
        case '/ping': {
            return handler.ping(searchParams)
        }
        case '/healthz': {
            return handler.healthz(searchParams)
        }
        case '/info': {
            if (!util.validateBasicAuth(request, basicAuth)) {
                return new Response('Unauthorized', {
                    status: 401,
                    headers: {
                        'content-type': 'text/plain',
                        'WWW-Authenticate': 'Basic realm="Bark"',
                    }
                })
            }
            return handler.info(searchParams)
        }
        case '/mcp': {
            if (!util.validateBasicAuth(request, basicAuth)) {
                return new Response('Unauthorized', {
                    status: 401,
                    headers: {
                        'content-type': 'text/plain',
                        'WWW-Authenticate': 'Basic realm="Bark"',
                    }
                })
            }
            return handler.mcp(request, undefined)
        }
        default: {
            const pathParts = realPathname.split('/')

            if (pathParts[1]) {
                if (!util.validateBasicAuth(request, basicAuth)) {
                    return new Response('Unauthorized', {
                        status: 401,
                        headers: {
                            'content-type': 'text/plain',
                            'WWW-Authenticate': 'Basic',
                        }
                    })
                }

                if (pathParts[1] === 'mcp') {
                    return handler.mcp(request, pathParts[2])
                }

                const contentType = request.headers.get('content-type')
                let requestBody = {}

                try {
                    if (contentType && contentType.includes('application/json')) {
                        requestBody = await request.json()

                        requestBody = Object.keys(requestBody).reduce((obj, key) => {
                            obj[key.toLowerCase()] = requestBody[key]
                            return obj
                        }, {})
                    } else if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
                        const formData = await request.formData()
                        formData.forEach((value, key) => { requestBody[key.toLowerCase()] = value })

                        try {
                            if (requestBody.title) {
                                requestBody.title = decodeURIComponent(requestBody.title.replaceAll('\+', '%20'))
                            }

                            if (requestBody.subtitle) {
                                requestBody.subtitle = decodeURIComponent(requestBody.subtitle.replaceAll('\+', '%20'))
                            }

                            if (requestBody.body) {
                                requestBody.body = decodeURIComponent(requestBody.body.replaceAll('\+', '%20'))
                            }

                            if (requestBody.markdown) {
                                requestBody.markdown = decodeURIComponent(requestBody.markdown.replaceAll('\+', '%20'))
                            }
                        } catch (error) {
                            return new Response(JSON.stringify({
                                'code': 500,
                                'message': `url path parse failed: ${error}`,
                                'timestamp': util.getTimestamp(),
                            }), {
                                status: 500,
                                headers: {
                                    'content-type': 'application/json',
                                }
                            })
                        }
                    } else {
                        searchParams.forEach((value, key) => { requestBody[key.toLowerCase()] = value })

                        if (pathParts.length === 3) {
                            requestBody.body = pathParts[2]
                        } else if (pathParts.length === 4) {
                            requestBody.title = pathParts[2]
                            requestBody.body = pathParts[3]
                        } else if (pathParts.length === 5) {
                            requestBody.title = pathParts[2]
                            requestBody.subtitle = pathParts[3]
                            requestBody.body = pathParts[4]
                        } else if (pathParts.length > 5) {
                            return new Response(JSON.stringify({
                                'code': 404,
                                'message': `Cannot ${request.method} ${realPathname}`,
                                'timestamp': util.getTimestamp(),
                            }), {
                                status: 404,
                                headers: {
                                    'content-type': 'application/json',
                                }
                            })
                        }

                        try {
                            if (requestBody.title) {
                                requestBody.title = decodeURIComponent(requestBody.title.replaceAll('\+', '%20'))
                            }

                            if (requestBody.subtitle) {
                                requestBody.subtitle = decodeURIComponent(requestBody.subtitle.replaceAll('\+', '%20'))
                            }

                            if (requestBody.body) {
                                requestBody.body = decodeURIComponent(requestBody.body.replaceAll('\+', '%20'))
                            }

                            if (requestBody.markdown) {
                                requestBody.markdown = decodeURIComponent(requestBody.markdown.replaceAll('\+', '%20'))
                            }
                        } catch (error) {
                            return new Response(JSON.stringify({
                                'code': 500,
                                'message': `url path parse failed: ${error}`,
                                'timestamp': util.getTimestamp(),
                            }), {
                                status: 500,
                                headers: {
                                    'content-type': 'application/json',
                                }
                            })
                        }
                    }

                    if (requestBody.device_keys && typeof requestBody.device_keys === 'string') {
                        if (requestBody.device_keys.startsWith('[') || requestBody.device_keys.endsWith(']')) {
                            requestBody.device_keys = JSON.parse(requestBody.device_keys)
                        } else {
                            requestBody.device_keys = (decodeURIComponent(requestBody.device_keys).trim()).split(',').map(item => item.replace(/['"]/g, '').trim())
                        }

                        if (typeof requestBody.device_keys === 'string') {
                            requestBody.device_keys = [requestBody.device_keys]
                        }
                    }
                } catch (error) {
                    return new Response(JSON.stringify({
                        'code': 400,
                        'message': `request bind failed: ${error}`,
                        'timestamp': util.getTimestamp(),
                    }), {
                        status: 400,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }

                if (requestBody.device_keys && requestBody.device_keys.length > 0) {
                    return new Response(JSON.stringify({
                        'code': 200,
                        'message': 'success',
                        'data': await Promise.all(requestBody.device_keys.map(async (device_key) => {
                            if (!device_key) {
                                return {
                                    code: 400,
                                    message: 'device key is empty',
                                    device_key: device_key,
                                }
                            }

                            const response = await handler.push({ ...requestBody, device_key })
                            const responseBody = await response.json()
                            return {
                                code: response.status,
                                message: responseBody.message,
                                device_key: device_key,
                            }
                        })),
                        'timestamp': util.getTimestamp(),
                    }), {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }

                if (realPathname != '/push') {
                    requestBody.device_key = pathParts[1]
                }

                if (!requestBody.device_key) {
                    return new Response(JSON.stringify({
                        'code': 400,
                        'message': 'device key is empty',
                        'timestamp': util.getTimestamp(),
                    }), {
                        status: 400,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }

                return handler.push(requestBody)
            }

            if (realPathname === '/') {
                return new Response('ok', {
                    status: 200,
                    headers: {
                        'content-type': 'text/plain',
                    }
                })
            }

            return new Response(JSON.stringify({
                'code': 404,
                'message': `Cannot ${request.method} ${realPathname}`,
                'timestamp': util.getTimestamp(),
            }), {
                status: 404,
                headers: {
                    'content-type': 'application/json',
                }
            })
        }
    }
}

const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Bark Admin</title>
  <style>
    :root { color-scheme: light; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #18212b; background: #f5f7fa; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px 18px; }
    main { max-width: 760px; margin: 0 auto; }
    h1 { margin: 0 0 22px; font-size: 24px; letter-spacing: -.03em; }
    section { background: #fff; border: 1px solid #e2e7ed; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .control { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
    .state { font-weight: 600; }
    .muted { color: #697586; font-size: 13px; margin: 5px 0 0; }
    button { border: 0; border-radius: 8px; background: #1f2937; color: white; padding: 10px 14px; font: inherit; cursor: pointer; white-space: nowrap; }
    button:disabled { opacity: .55; cursor: wait; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 11px 8px; text-align: left; border-bottom: 1px solid #edf0f3; }
    th { font-size: 12px; color: #697586; font-weight: 600; }
    td:first-child, th:first-child { width: 90px; }
    .table-wrap { overflow-x: auto; }
    .device-key { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
    .note-editor { display: flex; gap: 8px; min-width: 220px; }
    .note-editor input { min-width: 0; width: 100%; border: 1px solid #d9e0e7; border-radius: 7px; padding: 8px; font: inherit; }
    .note-editor button { padding: 8px 10px; }
    .note-status { color: #697586; font-size: 12px; }
    #message { min-height: 20px; color: #697586; font-size: 13px; }
    @media (max-width: 520px) { .control { align-items: flex-start; flex-direction: column; } section { padding: 16px; } }
  </style>
</head>
<body>
  <main>
    <h1>Bark Admin</h1>
    <section class="control">
      <div>
        <div class="state" id="registration-state">Loading…</div>
        <p class="muted" id="registration-until"></p>
      </div>
      <button id="registration-toggle" type="button" disabled>Loading…</button>
    </section>
    <section>
      <h2 style="font-size:16px;margin:0 0 12px">Registered devices</h2>
      <div id="message" role="status" aria-live="polite"></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Device key</th><th>Registered at</th><th>Note</th></tr></thead>
          <tbody id="devices"></tbody>
        </table>
      </div>
    </section>
  </main>
  <script>
    const stateLabel = document.querySelector('#registration-state');
    const untilLabel = document.querySelector('#registration-until');
    const toggle = document.querySelector('#registration-toggle');
    const devices = document.querySelector('#devices');
    const message = document.querySelector('#message');
    let status = null;

    function formatTime(seconds) {
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(seconds * 1000));
    }

    function render(data) {
      status = data;
      stateLabel.textContent = data.registrationOpen ? 'Registration is open' : 'Registration is closed';
      untilLabel.textContent = data.openUntil ? 'Closes automatically ' + formatTime(data.openUntil) : '';
      toggle.textContent = data.registrationOpen ? 'Close registration' : 'Open for 24 hours';
      toggle.disabled = false;
      devices.replaceChildren();
      for (const device of data.devices) {
        const row = document.createElement('tr');
        const id = document.createElement('td');
        const key = document.createElement('td');
        const registered = document.createElement('td');
        const note = document.createElement('td');
        const noteEditor = document.createElement('div');
        const noteInput = document.createElement('input');
        const saveNote = document.createElement('button');
        const noteStatus = document.createElement('span');

        id.textContent = String(device.id);
        key.textContent = device.key;
        key.className = 'device-key';
        registered.textContent = device.registeredAt ? formatTime(device.registeredAt) : 'Not recorded';
        noteEditor.className = 'note-editor';
        noteInput.type = 'text';
        noteInput.maxLength = 500;
        noteInput.value = device.note || '';
        noteInput.placeholder = 'Add a note';
        noteInput.setAttribute('aria-label', 'Note for device ' + device.id);
        saveNote.type = 'button';
        saveNote.textContent = 'Save';
        noteStatus.className = 'note-status';
        noteStatus.setAttribute('role', 'status');
        saveNote.addEventListener('click', async () => {
          saveNote.disabled = true;
          noteStatus.textContent = '';
          try {
            const response = await fetch('/admin/api/device-note', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: device.id, note: noteInput.value }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not save note');
            noteInput.value = result.note;
            noteStatus.textContent = 'Saved';
          } catch (error) {
            noteStatus.textContent = 'Save failed';
          } finally {
            saveNote.disabled = false;
          }
        });
        noteInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            saveNote.click();
          }
        });
        noteEditor.append(noteInput, saveNote);
        note.append(noteEditor, noteStatus);
        row.append(id, key, registered, note);
        devices.append(row);
      }
      message.textContent = data.devices.length ? '' : 'No devices registered.';
    }

    async function load() {
      try {
        const response = await fetch('/admin/api/status', { cache: 'no-store' });
        if (!response.ok) throw new Error('Could not load admin status');
        render(await response.json());
      } catch (error) {
        message.textContent = 'Could not load admin data.';
        stateLabel.textContent = 'Unavailable';
        toggle.disabled = true;
      }
    }

    toggle.addEventListener('click', async () => {
      if (!status) return;
      toggle.disabled = true;
      message.textContent = '';
      try {
        const response = await fetch('/admin/api/registration', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: !status.registrationOpen }),
        });
        if (!response.ok) throw new Error('Could not update registration');
        render(await response.json());
      } catch (error) {
        message.textContent = 'Could not update registration.';
        toggle.disabled = false;
      }
    });

    load();
    setInterval(load, 60000);
  </script>
</body>
</html>`

function adminJson(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
        },
    })
}

async function handleAdminPage(request) {
    if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } })
    }

    return new Response(ADMIN_HTML, {
        headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'no-referrer',
            'x-frame-options': 'DENY',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
        },
    })
}

async function handleAdminApi(request, db, path) {
    if (path === '/admin/api/status' && request.method === 'GET') {
        const state = await db.registrationState()
        const devices = await db.registeredDevices()

        return adminJson({
            registrationOpen: state.open,
            openUntil: state.openUntil,
            devices: devices.map((device) => ({
                id: device.id,
                key: device.key,
                registeredAt: Number(device.registered_at) || null,
                note: device.note,
            })),
        })
    }

    if (path === '/admin/api/registration' && request.method === 'POST') {
        const origin = request.headers.get('origin')
        if (origin !== 'https://bark.cedrat.im') {
            return adminJson({ error: 'Forbidden' }, 403)
        }

        let body
        try {
            body = await request.json()
        } catch {
            return adminJson({ error: 'Invalid JSON' }, 400)
        }

        if (typeof body.enabled !== 'boolean') {
            return adminJson({ error: 'enabled must be a boolean' }, 400)
        }

        const now = util.getTimestamp()
        const current = await db.registrationState()
        let openUntil = 0

        if (body.enabled) {
            openUntil = current.open ? current.openUntil : now + 24 * 60 * 60
        }

        await db.setRegistrationOpenUntil(openUntil)
        const state = await db.registrationState()
        const devices = await db.registeredDevices()

        return adminJson({
            registrationOpen: state.open,
            openUntil: state.openUntil,
            devices: devices.map((device) => ({
                id: device.id,
                key: device.key,
                registeredAt: Number(device.registered_at) || null,
                note: device.note,
            })),
        })
    }

    if (path === '/admin/api/device-note' && request.method === 'POST') {
        const origin = request.headers.get('origin')
        if (origin !== 'https://bark.cedrat.im') {
            return adminJson({ error: 'Forbidden' }, 403)
        }

        let body
        try {
            body = await request.json()
        } catch {
            return adminJson({ error: 'Invalid JSON' }, 400)
        }

        const id = Number(body.id)
        const note = typeof body.note === 'string' ? body.note.trim() : null
        if (!Number.isSafeInteger(id) || id < 1 || note === null || note.length > 500) {
            return adminJson({ error: 'Invalid device id or note (maximum 500 characters)' }, 400)
        }

        const result = await db.updateDeviceNote(id, note)
        if (!result.success) {
            return adminJson({ error: 'Could not save note' }, 500)
        }
        if (result.meta?.changes === 0 && !(await db.hasRegisteredDevice(id))) {
            return adminJson({ error: 'Device not found' }, 404)
        }

        return adminJson({ id, note })
    }

    return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: path === '/admin/api/status' ? 'GET' : 'POST' },
    })
}

class Handler {
    constructor(db, options) {
        this.version = 'v2.3.4'
        this.build = '2026-09-12 17:45:41'
        this.arch = 'js'
        this.commit = '3db0918856d5aca4d141300c84d5c7a9f851ba44'
        this.allowQueryNums = options.allowQueryNums

        this.register = async (parameters) => {
            const deviceToken = parameters.get('devicetoken')
            let key = parameters.get('key')

            if (!deviceToken) {
                return new Response(JSON.stringify({
                    'code': 400,
                    'message': 'device token is empty',
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 400,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            if (deviceToken.length > 160) {
                return new Response(JSON.stringify({
                    'code': 400,
                    'message': 'device token is invalid',
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 400,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            const existingDevice = key && await db.deviceTokenByKey(key) !== undefined
            if (!existingDevice) {
                const registration = await db.registrationState()
                if (!registration.open) {
                    return new Response(JSON.stringify({
                        'code': 403,
                        'message': 'device registration failed: register disabled',
                    }), {
                        status: 403,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }

                key = await util.newShortUUID()
            }

            await db.saveDeviceTokenByKey(key, deviceToken)

            return new Response(JSON.stringify({
                'code': 200,
                'message': 'success',
                'timestamp': util.getTimestamp(),
                'data': {
                    'key': key,
                    'device_key': key,
                    'device_token': deviceToken,
                },
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                }
            })
        }

        this.ping = async (parameters) => {
            return new Response(JSON.stringify({
                'code': 200,
                'message': 'pong',
                'timestamp': util.getTimestamp(),
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                }
            })
        }

        this.healthz = async (parameters) => {
            return new Response('ok', {
                status: 200,
                headers: {
                    'content-type': 'text/plain',
                }
            })
        }

        this.info = async (parameters) => {
            if (this.allowQueryNums) {
                this.devices = await db.countAll()
            }

            return new Response(JSON.stringify({
                'version': this.version,
                'build': this.build,
                'arch': this.arch,
                'commit': this.commit,
                'devices': this.devices,
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                }
            })
        }

        this.push = async (parameters) => {
            const deviceToken = await db.deviceTokenByKey(parameters.device_key)

            if (deviceToken === undefined) {
                return new Response(JSON.stringify({
                    'code': 400,
                    'message': `failed to get device token: failed to get [${parameters.device_key}] device token from database`,
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 400,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            if (!deviceToken) {
                return new Response(JSON.stringify({
                    'code': 400,
                    'message': 'device token invalid',
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 400,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            const title = parameters.title || undefined
            const subtitle = parameters.subtitle || undefined
            const body = parameters.body || undefined

            let sound = parameters.sound || undefined
            if (sound) {
                if (!sound.endsWith('.caf')) {
                    sound += '.caf'
                }
            } else {
                sound = '1107'
            }

            const group = parameters.group || undefined
            const call = parameters.call || undefined
            const isArchive = parameters.isarchive || undefined
            const icon = parameters.icon || undefined
            const ciphertext = parameters.ciphertext || undefined
            const level = parameters.level || undefined
            const volume = parameters.volume || undefined
            const url = parameters.url || undefined
            const image = parameters.image || undefined
            const copy = parameters.copy || undefined
            const badge = parameters.badge?.toString()
            const autoCopy = parameters.autocopy || undefined
            const action = parameters.action || undefined
            const iv = parameters.iv || undefined
            const id = parameters.id || undefined
            const _delete = parameters.delete || undefined
            const markdown = parameters.markdown || undefined
            const ttl = parameters.ttl || undefined

            // https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
            const aps = {
                'aps': (_delete) ? {
                    'content-available': 1,
                    'mutable-content': 1,
                } : {
                    'alert': {
                        'title': title,
                        'subtitle': subtitle,
                        'body': (!title && !subtitle && !body) ? 'Empty Message' : body,
                        'launch-image': undefined,
                        'title-loc-key': undefined,
                        'title-loc-args': undefined,
                        'subtitle-loc-key': undefined,
                        'subtitle-loc-args': undefined,
                        'loc-key': undefined,
                        'loc-args': undefined,
                    },
                    'badge': undefined,
                    'sound': sound,
                    'thread-id': group,
                    'category': 'myNotificationCategory',
                    'content-available': undefined,
                    'mutable-content': 1,
                    'target-content-id': undefined,
                    'interruption-level': undefined,
                    'relevance-score': undefined,
                    'filter-criteria': undefined,
                    'stale-date': undefined,
                    'content-state': undefined,
                    'timestamp': undefined,
                    'event': undefined,
                    'dimissal-date': undefined,
                    'attributes-type': undefined,
                    'attributes': undefined,
                },
                // ExtParams
                'group': group,
                'call': call,
                'isarchive': isArchive,
                'icon': icon,
                'ciphertext': ciphertext,
                'level': level,
                'volume': volume,
                'url': url,
                'copy': copy,
                'badge': badge,
                'autocopy': autoCopy,
                'action': action,
                'iv': iv,
                'image': image,
                'id': id,
                'delete': _delete,
                'markdown': markdown,
                'ttl': ttl,
            }

            const headers = {
                'apns-topic': undefined,
                'apns-id': undefined,
                'apns-collapse-id': id,
                'apns-priority': undefined,
                'apns-expiration': undefined,
                'apns-push-type': (_delete) ? 'background' : 'alert',
            }

            const apns = new APNs(db)
            const response = await apns.push(deviceToken, headers, aps)

            if (response.status === 200) {
                return new Response(JSON.stringify({
                    'code': 200,
                    'message': 'success',
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            } else {
                let message
                const responseText = await response.text()

                try {
                    message = JSON.parse(responseText).reason
                } catch (err) {
                    message = responseText
                }

                if ((response.status === 410) || ((response.status === 400) && (message.includes('BadDeviceToken')))) {
                    await db.saveDeviceTokenByKey(parameters.device_key, '')
                }

                return new Response(JSON.stringify({
                    'code': response.status,
                    'message': `push failed: ${message}`,
                    'timestamp': util.getTimestamp(),
                }), {
                    status: response.status,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }
        }

        this.mcp = async (request, deviceKey) => {
            if (request.method === 'DELETE') {
                const sessionId = request.headers.get('mcp-session-id')
                if (sessionId) {
                    await db.deleteSessionBySessionID(sessionId)
                }
                return new Response(null, {
                    status: 200
                })
            }

            if (request.method !== 'POST') {
                return new Response(JSON.stringify({
                    'jsonrpc': '2.0',
                    'id': null,
                    'error': {
                        'code': -32700,
                        'message': 'Method not allowed',
                    }
                }), {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            let body = {}
            try {
                body = await request.json()
            } catch (err) {
                return new Response(JSON.stringify({
                    'jsonrpc': '2.0',
                    'id': null,
                    'error': {
                        'code': -32700,
                        'message': 'request body is not valid json',
                    }
                }), {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            const {
                jsonrpc,
                id,
                method,
                params,
            } = body

            if (jsonrpc !== '2.0') {
                return new Response(JSON.stringify({
                    'jsonrpc': '2.0',
                    'id': id || null,
                    'error': {
                        'code': -32600,
                        'message': 'Invalid Request',
                    }
                }), {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            switch (method) {
                case 'initialize': {
                    const sessionId = await util.newMCPSessionUUID()
                    await db.saveSessionBySessionID(sessionId, deviceKey, true, null)

                    return new Response(JSON.stringify({
                        'jsonrpc': '2.0',
                        'id': id,
                        'result': {
                            'protocolVersion': '2025-03-26',
                            'capabilities': {
                                'tools': {
                                    'listChanged': true,
                                },
                            },
                            'serverInfo': {
                                name: deviceKey ? 'Bark MCP Server (Specific)' : 'Bark MCP Server',
                                version: this.version,
                            },
                        }
                    }), {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                            'mcp-session-id': sessionId,
                        }
                    })
                }
                case 'notifications/initialized': {
                    const sessionId = request.headers.get('mcp-session-id')
                    const session = await db.sessionBySessionID(sessionId)
                    
                    if (!session) {
                        return new Response(null, {
                            status: 400
                        })
                    }
                    
                    await db.saveSessionBySessionID(session.id, session.device_key, true, undefined)

                    return new Response(null, {
                        status: 202
                    })
                }
                case 'tools/list': {
                    const sessionId = request.headers.get('mcp-session-id')
                    const session = await db.sessionBySessionID(sessionId)
                    
                    if (!session) {
                        return new Response('Invalid session ID', {
                            status: 400,
                            headers: {
                                'content-type': 'text/plain',
                            }
                        })
                    }

                    await db.saveSessionBySessionID(session.id, session.device_key, true, undefined)

                    const sessionDeviceKey = session.device_key
                    const required = sessionDeviceKey ? [] : ['device_key']

                    const properties = {
                        'title':        { 'type': 'string', 'description': 'Notification title' },
                        'subtitle':     { 'type': 'string', 'description': 'Notification subtitle' },
                        'body':         { 'type': 'string', 'description': 'Notification content' },
                        'markdown':     { 'type': 'string', 'description': 'Markdown content, overrides body' },
                        'level':        { 'type': 'string', 'description': 'Notification level', 'enum': ['critical', 'active', 'timeSensitive', 'passive'] },
                        'volume':       { 'type': 'number', 'description': 'Alert volume (0–10)', 'minimum': 0, 'maximum': 10, 'default': 5 },
                        'badge':        { 'type': 'number', 'description': 'Badge number' },
                        'call':         { 'type': 'string', 'description': "Set to '1' to repeat ringtone" },
                        'sound':        { 'type': 'string', 'description': 'Notification sound name' },
                        'icon':         { 'type': 'string', 'description': 'Notification icon URL' },
                        'image':        { 'type': 'string', 'description': 'Notification image URL' },
                        'group':        { 'type': 'string', 'description': 'Notification group' },
                        'isArchive':    { 'type': 'string', 'description': "Set to '1' to archive, other value to skip" },
                        'ttl':          { 'type': 'number', 'description': 'Time to live in seconds for archived messages; expired items are automatically deleted' },
                        'url':          { 'type': 'string', 'description': 'Click action URL' },
                        'copy':         { 'type': 'string', 'description': 'Text to copy on copy action' },
                        'device_key': sessionDeviceKey ? undefined : { 'type': 'string', 'description': 'Device key' },
                    }

                    return new Response(JSON.stringify({
                        'jsonrpc': '2.0',
                        'id': id,
                        'result': {
                            'tools': [
                                {   
                                    'annotations': {
                                        'readOnlyHint': false,
                                        'destructiveHint': true,
                                        'idempotentHint': false,
                                        'openWorldHint': true
                                    },
                                    'name': 'notify',
                                    'description': 'Send a notification to a device via Bark',
                                    'inputSchema': {
                                        'type': 'object',
                                        'properties': properties,
                                        ...(required.length > 0 ? { required } : {})
                                    },
                                },
                            ]
                        }
                    }), {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }
                case 'tools/call': {
                    const sessionId = request.headers.get('mcp-session-id')
                    const session = await db.sessionBySessionID(sessionId)
                    
                    if (!session) {
                        return new Response('Invalid session ID', {
                            status: 400,
                            headers: {
                                'content-type': 'text/plain',
                            }
                        })
                    }

                    await db.saveSessionBySessionID(session.id, session.device_key, true, undefined)

                    const { name, arguments: args = {} } = params || {}

                    if (name !== 'notify') {
                        return new Response(JSON.stringify({
                            'jsonrpc': '2.0',
                            'id': id,
                            'error': {
                                'code': -32602,
                                'message': `tool '${name}' not found: tool not found`,
                            }
                        }), {
                            status: 200,
                            headers: {
                                'content-type': 'application/json',
                            }
                        })
                    }

                    const _deviceKey = session.device_key || args.device_key || ''
                    if (!_deviceKey) {
                        return new Response(JSON.stringify({
                            'jsonrpc': '2.0',
                            'id': id,
                            'result': {
                                'content': [
                                    {
                                        'type': 'text',
                                        'text': 'device_key is required',
                                    }
                                ],
                                'isError': true,
                            }
                        }), {
                            status: 200,
                            headers: {
                                'content-type': 'application/json',
                            }
                        })
                    }
                    
                    const parameters = { ...args, 'device_key': _deviceKey }
                    const pushParams = Object.keys(parameters).reduce((obj, key) => {
                        obj[key.toLowerCase()] = parameters[key]
                        return obj
                    }, {})

                    const response = await this.push(pushParams)
                    const responseBody = await response.json()

                    if (response.status === 200) {
                        return new Response(JSON.stringify({
                            'jsonrpc': '2.0',
                            'id': id,
                            'result': {
                                'content': [
                                    {
                                        'type': 'text',
                                        'text': 'Notification sent successfully',
                                    }
                                ]
                            }
                        }), {
                            status: 200,
                            headers: {
                                'content-type': 'application/json',
                            }
                        })
                    }

                    return new Response(JSON.stringify({
                        'jsonrpc': '2.0',
                        'id': id,
                        'result': {
                            'content': [
                                {
                                    'type': 'text',
                                    'text': `Failed to send notification: ${responseBody.message}`,
                                }
                            ],
                            'isError': true,
                        }
                    }), {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })

                }
                default: {
                    return new Response(JSON.stringify({
                        'jsonrpc': '2.0',
                        'id': id || null,
                        'error': {
                            'code': -32601,
                            'message': `Method not found: ${method}`,
                        }
                    }), {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }
            }
        }
    }
}

class APNs {
    constructor(db) {
        const generateAuthToken = async () => {
            const TOKEN_KEY = `
            -----BEGIN PRIVATE KEY-----
            MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg4vtC3g5L5HgKGJ2+
            T1eA0tOivREvEAY2g+juRXJkYL2gCgYIKoZIzj0DAQehRANCAASmOs3JkSyoGEWZ
            sUGxFs/4pw1rIlSV2IC19M8u3G5kq36upOwyFWj9Gi3Ejc9d3sC7+SHRqXrEAJow
            8/7tRpV+
            -----END PRIVATE KEY-----
            `

            // Parse private key
            const privateKeyPEM = TOKEN_KEY.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '')
            // Decode private key
            const privateKeyArrayBuffer = util.base64ToArrayBuffer(privateKeyPEM)
            const privateKey = await crypto.subtle.importKey('pkcs8', privateKeyArrayBuffer, { name: 'ECDSA', namedCurve: 'P-256', }, false, ['sign'])
            const TEAM_ID = '5U8LBRXG3A'
            const AUTH_KEY_ID = 'LH4T9V5U4R'
            // Generate the JWT token
            const JWT_ISSUE_TIME = util.getTimestamp()
            const JWT_HEADER = btoa(JSON.stringify({ alg: 'ES256', kid: AUTH_KEY_ID })).replace('+', '-').replace('/', '_').replace(/=+$/, '')
            const JWT_CLAIMS = btoa(JSON.stringify({ iss: TEAM_ID, iat: JWT_ISSUE_TIME })).replace('+', '-').replace('/', '_').replace(/=+$/, '')
            const JWT_HEADER_CLAIMS = JWT_HEADER + '.' + JWT_CLAIMS
            // Sign
            const jwtArray = new TextEncoder().encode(JWT_HEADER_CLAIMS)
            const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, jwtArray)
            const signatureArray = new Uint8Array(signature)
            const JWT_SIGNED_HEADER_CLAIMS = btoa(String.fromCharCode(...signatureArray)).replace('+', '-').replace('/', '_').replace(/=+$/, '')
            const AUTHENTICATION_TOKEN = JWT_HEADER_CLAIMS + '.' + JWT_SIGNED_HEADER_CLAIMS

            return AUTHENTICATION_TOKEN
        }

        const getAuthToken = async () => {
            let authToken = await db.authorizationToken()

            if (authToken) {
                return await authToken
            }

            authToken = await generateAuthToken()
            await db.saveAuthorizationToken(authToken)

            return authToken
        }

        this.push = async (deviceToken, headers, aps) => {
            const TOPIC = 'me.fin.bark'
            const APNS_HOST_NAME = 'api.push.apple.com'
            const AUTHENTICATION_TOKEN = await getAuthToken()

            return await fetch(`https://${APNS_HOST_NAME}/3/device/${deviceToken}`, {
                method: 'POST',
                headers: JSON.parse(JSON.stringify({
                    'apns-topic': headers['apns-topic'] || TOPIC,
                    'apns-id': headers['apns-id'] || undefined,
                    'apns-collapse-id': headers['apns-collapse-id'] || undefined,
                    'apns-priority': (headers['apns-priority'] > 0) ? headers['apns-priority'] : undefined,
                    'apns-expiration': headers['apns-expiration'] || util.getTimestamp() + 86400,
                    'apns-push-type': headers['apns-push-type'] || 'alert',
                    'authorization': `bearer ${AUTHENTICATION_TOKEN}`,
                    'content-type': 'application/json',
                })),
                body: JSON.stringify(aps),
            })
        }
    }
}

let cachedAuthToken = {}
let cachedDeviceToken = {}
let cachedMCPSession = {}

class Database {
    constructor(env) {
        const db = env.database

        db.exec('CREATE TABLE IF NOT EXISTS `devices` (`id` INTEGER PRIMARY KEY, `key` VARCHAR(255) NOT NULL, `token` VARCHAR(255) NOT NULL, `registered_at` INTEGER NOT NULL DEFAULT 0, `note` TEXT NOT NULL DEFAULT \'\', UNIQUE (`key`))')
        db.exec('CREATE TABLE IF NOT EXISTS `authorization` (`id` INTEGER PRIMARY KEY, `token` VARCHAR(255) NOT NULL, `time` VARCHAR(255) NOT NULL)')
        db.exec('CREATE TABLE IF NOT EXISTS `sessions` (`id` VARCHAR(64) PRIMARY KEY, `device_key` VARCHAR(255), `initialized` INTEGER DEFAULT 0, `created_at` INTEGER NOT NULL, `last_seen` INTEGER NOT NULL)')
        db.exec('CREATE TABLE IF NOT EXISTS `registration_control` (`id` INTEGER PRIMARY KEY CHECK (`id` = 1), `open_until` INTEGER NOT NULL DEFAULT 0)')
        db.exec('INSERT OR IGNORE INTO `registration_control` (`id`, `open_until`) VALUES (1, 0)')

        this.countAll = async () => {
            const query = 'SELECT COUNT(*) as rowCount FROM `devices`'
            const result = await db.prepare(query).run()

            return (result.results[0] || { 'rowCount': -1 }).rowCount
        }

        this.registrationState = async () => {
            const result = await db.prepare('SELECT `open_until` FROM `registration_control` WHERE `id` = 1').run()
            let openUntil = Number((result.results[0] || {}).open_until || 0)
            const now = util.getTimestamp()

            if (openUntil > 0 && openUntil <= now) {
                await this.setRegistrationOpenUntil(0)
                openUntil = 0
            }

            return {
                open: openUntil > now,
                openUntil: openUntil > now ? openUntil : null,
            }
        }

        this.setRegistrationOpenUntil = async (openUntil) => {
            const query = 'INSERT INTO `registration_control` (`id`, `open_until`) VALUES (1, ?) ON CONFLICT(`id`) DO UPDATE SET `open_until` = EXCLUDED.`open_until`'
            return await db.prepare(query).bind(openUntil).run()
        }

        this.registeredDevices = async () => {
            const query = 'SELECT `id`, `key`, `registered_at`, `note` FROM `devices` WHERE `token` != \'\' ORDER BY `registered_at` DESC, `id` DESC'
            const result = await db.prepare(query).run()
            return result.results || []
        }

        this.updateDeviceNote = async (id, note) => {
            const query = 'UPDATE `devices` SET `note` = ? WHERE `id` = ? AND `token` != \'\''
            return await db.prepare(query).bind(note, id).run()
        }

        this.hasRegisteredDevice = async (id) => {
            const result = await db.prepare('SELECT `id` FROM `devices` WHERE `id` = ? AND `token` != \'\'').bind(id).run()
            return result.results.length > 0
        }

        this.deviceTokenByKey = async (key) => {
            const device_key = (key || '').replace(/[^a-zA-Z0-9]/g, '') || '_PLACE_HOLDER_'

            if (device_key && cachedDeviceToken[device_key]) {
                return cachedDeviceToken[device_key]
            }

            const query = 'SELECT `token` FROM `devices` WHERE `key` = ?'
            const result = await db.prepare(query).bind(device_key).run()

            if (result.results.length > 0) {
                cachedDeviceToken[device_key] = result.results[0].token

                return result.results[0].token
            }
            
            return undefined
        }

        this.saveDeviceTokenByKey = async (key, token) => {
            const device_token = (token || '').replace(/[^a-z0-9]/g, '') || ''
            const query = 'INSERT INTO `devices` (`key`, `token`, `registered_at`) VALUES (?, ?, ?) ON CONFLICT(`key`) DO UPDATE SET `token` = EXCLUDED.`token`, `registered_at` = CASE WHEN `devices`.`registered_at` = 0 THEN EXCLUDED.`registered_at` ELSE `devices`.`registered_at` END'
            const result = await db.prepare(query).bind(key, device_token, util.getTimestamp()).run()

            if (device_token === '') {
                delete cachedDeviceToken[key]
            } else {
                cachedDeviceToken[key] = device_token
            }

            return result
        }

        this.deleteDeviceByKey = async (key) => {
            const device_key = (key || '').replace(/[^a-zA-Z0-9]/g, '') || '_PLACE_HOLDER_'
            const query = 'DELETE FROM `devices` WHERE `key` = ?'
            const result = await db.prepare(query).bind(device_key).run()

            delete cachedDeviceToken[device_key]

            return result
        }

        this.saveAuthorizationToken = async (token) => {
            const timestamp = util.getTimestamp()
            const query = 'INSERT INTO `authorization` (`id`, `token`, `time`) VALUES (1, ?, ?) ON CONFLICT(`id`) DO UPDATE SET `token` = EXCLUDED.`token`,`time` = EXCLUDED.`time`'
            const result = await db.prepare(query).bind(token, timestamp).run()

            cachedAuthToken = {
                'token': token,
                'timestamp': timestamp,
            }

            return result
        }

        this.authorizationToken = async () => {
            if (cachedAuthToken && (util.getTimestamp() - cachedAuthToken.timestamp < 3000)) {
                return cachedAuthToken.token
            }

            const query = 'SELECT `token`, `time` FROM `authorization` WHERE `id` = 1'
            const result = await db.prepare(query).run()

            if (result.results.length > 0) {
                const tokenTime = parseInt(result.results[0].time)

                if (util.getTimestamp() - tokenTime <= 3000) {
                    cachedAuthToken = {
                        'token': result.results[0].token,
                        'timestamp': tokenTime,
                    }

                    return result.results[0].token
                }
            }

            return undefined
        }

        this.sessionBySessionID = async (sessionId) => {
            const timestamp = util.getTimestamp()

            if (sessionId && cachedMCPSession[sessionId]) {
                const session = cachedMCPSession[sessionId]
                if (session.last_seen > timestamp - 3600 && session.created_at > timestamp - 86400) {
                    return session
                } else {
                    delete cachedMCPSession[sessionId]
                }
            }

            const query = 'SELECT `id`, `device_key`, `initialized`, `created_at`, `last_seen` FROM `sessions` WHERE `id` = ? AND `last_seen` > ? AND `created_at` > ?'
            const result = await db.prepare(query).bind(sessionId, timestamp - 3600, timestamp - 86400).run()

            if (result.results.length > 0) {
                cachedMCPSession[sessionId] = result.results[0]

                return result.results[0]
            }

            return undefined
        }

        this.saveSessionBySessionID = async (sessionId, deviceKey, initialized, lastSeen) => {
            const timestamp = util.getTimestamp()
            const query = 'INSERT INTO `sessions` (`id`, `device_key`, `initialized`, `created_at`, `last_seen`) VALUES (?, ?, ?, ?, ?) ON CONFLICT(`id`) DO UPDATE SET `initialized` = EXCLUDED.`initialized`, `last_seen` = EXCLUDED.`last_seen`'
            const result = await db.prepare(query).bind(sessionId, deviceKey || null, initialized ? 1 : 0, timestamp, lastSeen ?? timestamp).run()

            if (cachedMCPSession[sessionId]) {
                cachedMCPSession[sessionId].initialized = initialized ? 1 : 0
                cachedMCPSession[sessionId].last_seen = lastSeen ?? timestamp
            } else {
                cachedMCPSession[sessionId] = {
                    id: sessionId,
                    device_key: deviceKey || null,
                    initialized: initialized ? 1 : 0,
                    created_at: timestamp,
                    last_seen: lastSeen ?? timestamp
                }
            }

            return result
        }

        this.deleteSessionBySessionID = async (sessionId) => {
            const query = 'DELETE FROM `sessions` WHERE `id` = ?'
            const result = await db.prepare(query).bind(sessionId).run()

            delete cachedMCPSession[sessionId]

            return result
        }

        this.cleanupExpiredSessions = async () => {
            const timestamp = util.getTimestamp()

            const query = 'DELETE FROM `sessions` WHERE `last_seen` < ? OR `created_at` < ?'
            const result = await db.prepare(query).bind(timestamp - 3600, timestamp - 86400).run()

            for (const id in cachedMCPSession) {
                const session = cachedMCPSession[id]
                if (session.last_seen < timestamp - 3600 || session.created_at < timestamp - 86400) {
                    delete cachedMCPSession[id]
                }
            }

            return result
        }
    }
}

class Util {
    constructor() {
        this.getTimestamp = () => {
            return Math.floor(Date.now() / 1000)
        }

        this.base64ToArrayBuffer = (base64) => {
            const binaryString = atob(base64)
            const length = binaryString.length
            const buffer = new Uint8Array(length)
            for (let i = 0; i < length; i++) {
                buffer[i] = binaryString.charCodeAt(i)
            }
            return buffer
        }

        this.newShortUUID = async () => {
            const uuid = crypto.randomUUID()
            const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uuid))
            const hashArray = Array.from(new Uint8Array(hashBuffer))

            return btoa(String.fromCharCode(...hashArray)).replace(/[^a-zA-Z0-9]|[lIO01]/g, '').slice(0, 22)
        }

        this.newMCPSessionUUID = async () => {
            const uuid = crypto.randomUUID()
            
            return `mcp-session-${uuid}`
        }

        const constantTimeCompare = (a, b) => {
            if (typeof a !== 'string' || typeof b !== 'string') { return false }
            if (a.length !== b.length) { return false }
            let result = 0
            for (let i = 0; i < a.length; i++) {
                result |= a.charCodeAt(i) ^ b.charCodeAt(i)
            }
            return result === 0
        }

        this.validateBasicAuth = (request, basicAuth) => {
            if (basicAuth) {
                const authHeader = request.headers.get('Authorization')
                if (typeof authHeader !== 'string' || !authHeader.startsWith('Basic ')) { return false }
                const received = authHeader.slice(6) // Remove 'Basic ' prefix
                const expected = btoa(`${basicAuth}`)
                return constantTimeCompare(received, expected)
            }
            return true
        }
    }
}

const util = new Util()

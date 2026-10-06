import type { FastifyInstance } from 'fastify';
import { sharedView } from '../services/bookings.js';

export async function shareRoutes(app: FastifyInstance) {
  // ---- public trip share (no login; limited data; expiring) ----
  app.get('/share/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const accepts = String(req.headers.accept ?? '');
    if (accepts.includes('application/json')) return sharedView(token);
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(SHARE_HTML.replace('__TOKEN__', encodeURIComponent(token)));
  });
}

const SHARE_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trip status</title>
<style>body{font-family:system-ui;margin:0;background:#f4f7f4;color:#14281d}main{max-width:480px;margin:0 auto;padding:20px}.c{background:#fff;border-radius:14px;padding:16px;margin-top:12px;box-shadow:0 1px 4px #0001}h1{color:#00704a}small{color:#567}</style></head>
<body><main><h1>Rwanda Mobility</h1><div id="o" class="c">Loading…</div><small>This link shows limited trip details and expires automatically.</small></main>
<script>async function r(){try{const x=await fetch('/share/__TOKEN__',{headers:{accept:'application/json'}});const j=await x.json();if(!x.ok){o.textContent='This link has expired or is no longer available.';return}
o.innerHTML='<b>Status:</b> '+j.status.replace(/_/g,' ')+'<br>'+(j.driver?('<b>Driver:</b> '+j.driver.first_name+'<br><b>Vehicle:</b> '+j.driver.vehicle+' ('+j.driver.plate+')<br>'):'')+(j.destination?('<b>To:</b> '+j.destination+'<br>'):'')+(j.location?('<b>Last position:</b> <a href="https://www.openstreetmap.org/?mlat='+j.location.lat+'&mlon='+j.location.lng+'#map=16/'+j.location.lat+'/'+j.location.lng+'">open map</a> ('+new Date(j.location.at).toLocaleTimeString()+')<br>'):'')}catch(e){o.textContent='Offline. Retrying…'}}
r();setInterval(r,10000)</script></body></html>`;

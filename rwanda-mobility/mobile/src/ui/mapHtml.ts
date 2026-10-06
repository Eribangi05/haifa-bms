// Leaflet + OpenStreetMap page used by the native WebView and the web iframe. No API key needed.
// Tile usage policy: fine for pilots; use a commercial/self-hosted tile server at scale (docs/MAP_PROVIDER_EVALUATION.md).
export const MAP_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#m{height:100%;margin:0}.l{font:12px sans-serif;background:#fff;padding:2px 6px;border-radius:6px}</style></head><body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
function post(o){var s=JSON.stringify(o);if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(s)}else if(window.parent!==window){window.parent.postMessage(s,'*')}}
var map,pin,layer,zl;
function init(s){
  if(!window.L){post({t:'status',ok:false});return}
  map=L.map('m',{zoomControl:false,attributionControl:true}).setView([s.c.lat,s.c.lng],s.z||14);
  var tl=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
  var errs=0;tl.on('tileerror',function(){errs++;if(errs>3)post({t:'status',ok:false})});tl.on('tileload',function(){post({t:'status',ok:true})});
  layer=L.layerGroup().addTo(map);zl=L.layerGroup().addTo(map);
  map.on('click',function(e){post({t:'tap',lat:e.latlng.lat,lng:e.latlng.lng})});
  post({t:'ready'});apply(s);
}
function apply(s){
  if(!map)return;layer.clearLayers();zl.clearLayers();
  (s.zones||[]).forEach(function(r){L.polygon(r.map(function(p){return[p[1],p[0]]}),{color:'#00704A',weight:2,fillOpacity:.05,dashArray:'6'}).addTo(zl)});
  (s.m||[]).forEach(function(k){L.circleMarker([k.lat,k.lng],{radius:8,color:k.color||'#1A5FB4',fillOpacity:.9}).addTo(layer);if(k.label)L.marker([k.lat,k.lng],{opacity:0}).bindTooltip(k.label,{permanent:true,direction:'top',className:'l'}).addTo(layer)});
  if(pin){map.removeLayer(pin);pin=null}
  if(s.p){pin=L.marker([s.p.lat,s.p.lng],{draggable:true}).addTo(map);pin.on('dragend',function(){var q=pin.getLatLng();post({t:'pin',lat:q.lat,lng:q.lng})})}
  if(s.fit&&s.fit.length>1){map.fitBounds(s.fit.map(function(p){return[p.lat,p.lng]}),{padding:[40,40]})}else if(s.c&&s.recenter){map.setView([s.c.lat,s.c.lng],map.getZoom())}
}
window.addEventListener('message',function(e){try{var s=JSON.parse(e.data);if(s.init)init(s);else apply(s)}catch(_){}});
document.addEventListener('message',function(e){try{var s=JSON.parse(e.data);if(s.init)init(s);else apply(s)}catch(_){}});
</script></body></html>`;

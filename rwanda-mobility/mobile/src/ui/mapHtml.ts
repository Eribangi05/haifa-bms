import { API_URL } from '../config';

/** Where the Rwanda base map lives. The API serves it (backend/map: one PMTiles file + MapLibre + fonts); override with EXPO_PUBLIC_MAP_BASE for a CDN. */
export const MAP_BASE = (process.env.EXPO_PUBLIC_MAP_BASE ?? `${API_URL}/map`).replace(/\/$/, '');

// MapLibre GL + Rwanda vector tiles (OpenStreetMap data, PMTiles) page used by the native WebView and the web iframe. No API key needed.
// If the vector map cannot start it falls back to the public OpenStreetMap raster tiles; if that fails too the parent shows landmark chips.
// Map docs: docs/MAP.md. Message protocol with the parent is unchanged from the old Leaflet page.
export const MAP_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="${MAP_BASE}/lib/maplibre-gl.css"/>
<style>html,body,#m{height:100%;margin:0}.l{font:600 12px sans-serif;background:#fff;color:#0F3554;padding:2px 6px;border-radius:6px;white-space:nowrap;box-shadow:0 1px 3px #0003;transform:translateY(-18px)}
.d{width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 1px 4px #0006}.pin{width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#E5384B;border:3px solid #fff;box-shadow:0 1px 5px #0006}
.maplibregl-ctrl-attrib{font-size:10px}</style></head><body><div id="m"></div>
<script src="${MAP_BASE}/lib/maplibre-gl.js"></script><script src="${MAP_BASE}/lib/pmtiles.js"></script>
<script>
var BASE=${JSON.stringify(MAP_BASE)};
function post(o){var s=JSON.stringify(o);if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(s)}else if(window.parent!==window){window.parent.postMessage(s,'*')}}
var map,pin,markers=[],loaded=false;
var NAME=['coalesce',['get','name:rw'],['get','name:latin'],['get','name']];
var F='Noto Sans Regular';
function lyr(id,type,src,paint,o){var l={id:id,type:type,source:'rw','source-layer':src,paint:paint||{}};for(var k in o||{})l[k]=o[k];return l}
function vectorStyle(){
  var road=function(id,cls,w,col,minz,casing){return [lyr(id+'-c','line','transportation',{'line-color':casing||'#c9c2b0','line-width':['interpolate',['exponential',1.4],['zoom'],8,w*.35,14,w*1.6,18,w*5]},{filter:['all',['in','class'].concat(cls),['!=','brunnel','tunnel']],minzoom:minz,layout:{'line-cap':'round','line-join':'round'}}),
    lyr(id,'line','transportation',{'line-color':col,'line-width':['interpolate',['exponential',1.4],['zoom'],8,w*.2,14,w,18,w*4]},{filter:['all',['in','class'].concat(cls),['!=','brunnel','tunnel']],minzoom:minz,layout:{'line-cap':'round','line-join':'round'}})]};
  var L=[{id:'bg',type:'background',paint:{'background-color':'#F2EFE6'}},
    lyr('wood','fill','landcover',{'fill-color':'#CFE3C0','fill-opacity':.7},{filter:['==','class','wood']}),
    lyr('grass','fill','landcover',{'fill-color':'#E1EDCF'},{filter:['in','class','grass','farmland']}),
    lyr('park','fill','park',{'fill-color':'#CFE8C0','fill-opacity':.8}),
    lyr('res','fill','landuse',{'fill-color':'#ECE7DA'},{filter:['in','class','residential','suburb','neighbourhood']}),
    lyr('comm','fill','landuse',{'fill-color':'#F0DDE0','fill-opacity':.6},{filter:['in','class','commercial','retail','industrial']}),
    lyr('campus','fill','landuse',{'fill-color':'#E6E2EE'},{filter:['in','class','school','university','hospital','college']}),
    lyr('water','fill','water',{'fill-color':'#A8CDEB'}),
    lyr('river','line','waterway',{'line-color':'#A8CDEB','line-width':['interpolate',['linear'],['zoom'],8,.6,14,2]})]
    .concat(road('path',['path','track'],1.2,'#d9b8a0',14,'#fff0'))
    .concat(road('minor',['minor','service'],3,'#fff',12))
    .concat(road('tert',['tertiary'],4.5,'#fff',10))
    .concat(road('sec',['secondary'],5.5,'#FDEBB2',8,'#d8b857'))
    .concat(road('pri',['primary'],6.5,'#FBD77A',6,'#d19c1c'))
    .concat(road('trunk',['trunk','motorway'],7.5,'#F6B84A',5,'#c47f12'))
    .concat([
    lyr('bldg','fill','building',{'fill-color':'#DAD3C3','fill-outline-color':'#C6BEAA'},{minzoom:14}),
    lyr('bound','line','boundary',{'line-color':'#8E7CA6','line-width':1.2,'line-dasharray':[3,2]},{filter:['<=','admin_level',4]}),
    lyr('roadname','symbol','transportation_name',{'text-color':'#444','text-halo-color':'#fff','text-halo-width':1.6},{minzoom:14,layout:{'symbol-placement':'line','text-field':NAME,'text-font':[F],'text-size':11}}),
    lyr('poi','symbol','poi',{'text-color':'#0F3554','text-halo-color':'#fff','text-halo-width':1.4},{minzoom:14,filter:['<=','rank',20],layout:{'text-field':NAME,'text-font':[F],'text-size':11,'text-anchor':'top','text-offset':[0,.6],'text-optional':true}}),
    lyr('wname','symbol','water_name',{'text-color':'#2f6f9f','text-halo-color':'#fff','text-halo-width':1},{layout:{'text-field':NAME,'text-font':[F],'text-size':12}}),
    lyr('vill','symbol','place',{'text-color':'#333','text-halo-color':'#fff','text-halo-width':1.6},{minzoom:11,filter:['in','class','village','suburb','neighbourhood','hamlet','quarter'],layout:{'text-field':NAME,'text-font':[F],'text-size':['interpolate',['linear'],['zoom'],11,11,15,14]}}),
    lyr('town','symbol','place',{'text-color':'#111','text-halo-color':'#fff','text-halo-width':1.8},{minzoom:7,filter:['in','class','town','city'],layout:{'text-field':NAME,'text-font':[F],'text-size':['interpolate',['linear'],['zoom'],7,12,12,18],'text-transform':'none'}}),
    lyr('state','symbol','place',{'text-color':'#7a6a90','text-halo-color':'#fff','text-halo-width':1.4},{maxzoom:9,filter:['in','class','state','country'],layout:{'text-field':NAME,'text-font':[F],'text-size':13}})]);
  return {version:8,glyphs:BASE+'/fonts/{fontstack}/{range}.pbf',sources:{rw:{type:'vector',url:'pmtiles://'+BASE+'/rwanda.pmtiles',attribution:'© OpenStreetMap contributors · © OpenMapTiles'}},layers:L};
}
function rasterStyle(){return {version:8,sources:{r:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© OpenStreetMap contributors'}},layers:[{id:'r',type:'raster',source:'r'}]}}
function circle(lat,lng,r){var pts=[],d=r/111320,i;for(i=0;i<=32;i++){var a=i/32*2*Math.PI;pts.push([lng+d*Math.sin(a)/Math.cos(lat*Math.PI/180),lat+d*Math.cos(a)])}return [pts]}
function el(cls,color){var e=document.createElement('div');e.className=cls;if(color)e.style.background=color;return e}
function init(s){
  if(!window.maplibregl||!window.pmtiles){post({t:'status',ok:false});return}
  try{maplibregl.addProtocol('pmtiles',new pmtiles.Protocol().tile)}catch(e){}
  var raster=false,errs=0;
  function start(st){
    if(map){map.remove();map=null}
    map=new maplibregl.Map({container:'m',style:st,center:[s.c.lng,s.c.lat],zoom:(s.z||14)-1,attributionControl:{compact:true},maxBounds:raster?undefined:[[27.8,-3.2],[31.2,-0.7]],dragRotate:false,pitchWithRotate:false});
    map.touchZoomRotate.disableRotation();
    map.on('error',function(e){errs++;if(errs>3){if(!raster){raster=true;errs=0;start(rasterStyle())}else post({t:'status',ok:false})}});
    map.on('load',function(){loaded=true;post({t:'status',ok:true});
      map.addSource('zones',{type:'geojson',data:{type:'FeatureCollection',features:[]}});map.addSource('heat',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
      map.addLayer({id:'zf',type:'fill',source:'zones',paint:{'fill-color':'#0077B0','fill-opacity':.05}});map.addLayer({id:'zl',type:'line',source:'zones',paint:{'line-color':'#0077B0','line-width':2,'line-dasharray':[3,2]}});
      map.addLayer({id:'hf',type:'fill',source:'heat',paint:{'fill-color':['get','color'],'fill-opacity':['get','o']}});
      apply(window.__s||s)});
    map.on('click',function(e){post({t:'tap',lat:e.lngLat.lat,lng:e.lngLat.lng})});
  }
  start(vectorStyle());
  window.__s=s;
}
function apply(s){
  window.__s=s;if(!map||!loaded)return;
  markers.forEach(function(m){m.remove()});markers=[];
  map.getSource('zones').setData({type:'FeatureCollection',features:(s.zones||[]).map(function(r){return{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[r.concat([r[0]])]}}})});
  map.getSource('heat').setData({type:'FeatureCollection',features:(s.h||[]).map(function(c){return{type:'Feature',properties:{color:c.color,o:c.o},geometry:{type:'Polygon',coordinates:circle(c.lat,c.lng,c.r||250)}}})});
  (s.m||[]).forEach(function(k){var e=el('d',k.color||'#1A5FB4');markers.push(new maplibregl.Marker({element:e}).setLngLat([k.lng,k.lat]).addTo(map));
    if(k.label){var t=el('l');t.textContent=k.label;markers.push(new maplibregl.Marker({element:t}).setLngLat([k.lng,k.lat]).addTo(map))}});
  if(pin){pin.remove();pin=null}
  if(s.p){pin=new maplibregl.Marker({element:el('pin'),draggable:true,anchor:'bottom'}).setLngLat([s.p.lng,s.p.lat]).addTo(map);pin.on('dragend',function(){var q=pin.getLngLat();post({t:'pin',lat:q.lat,lng:q.lng})})}
  if(s.fit&&s.fit.length>1){var b=new maplibregl.LngLatBounds();s.fit.forEach(function(p){b.extend([p.lng,p.lat])});map.fitBounds(b,{padding:40,animate:false})}else if(s.c&&s.recenter){map.jumpTo({center:[s.c.lng,s.c.lat]})}
}
function onMsg(e){try{var s=JSON.parse(e.data);if(s.init)init(s);else apply(s)}catch(_){}}
window.addEventListener('message',onMsg);document.addEventListener('message',onMsg);
post({t:'ready'});   // the parent answers with {init:true,...}
</script></body></html>`;

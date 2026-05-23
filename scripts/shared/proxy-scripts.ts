
export const PERMISSIVE_VIEWPORT =
  '<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=0.1, maximum-scale=5">';

export const KEEP_ACTIVE_SCRIPT = `<script data-uix-keepactive>(function(){try{
var W=window,D=document;
W.__uixKeepActive=true;
var def=function(o,k,v){try{Object.defineProperty(o,k,{configurable:true,get:function(){return v;}});}catch(e){}};

// Only fake "page is visible" — this is what stops browsers from throttling
// background timers. Vendor-prefixed variants are kept for older sites that
// poll them directly.
def(Document.prototype,'hidden',false);
def(Document.prototype,'webkitHidden',false);
def(Document.prototype,'mozHidden',false);
def(Document.prototype,'msHidden',false);
def(Document.prototype,'visibilityState','visible');
def(Document.prototype,'webkitVisibilityState','visible');
def(Document.prototype,'mozVisibilityState','visible');
def(Document.prototype,'msVisibilityState','visible');

// Block only the Page Lifecycle freeze event so the browser doesn't discard
// the iframe when the tab is backgrounded. visibilitychange / blur / pagehide
// / offline keep firing — those are real-user signals Cloudflare expects to
// see, and suppressing them is a bot tell.
var origAdd=EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener=function(type,listener,options){
  if(typeof type==='string'&&type.toLowerCase()==='freeze'&&(this===D||this===W))return;
  return origAdd.call(this,type,listener,options);
};
}catch(e){}})();</script>`;

export const IP_DIAG_SCRIPT = `<script data-uix-ipdiag>(function(){
var TAG='%c[UIX-IP]',S='color:#2a6df4;font-weight:600';
console.log(TAG+' === діагностика IP стартує ===',S);

// 1) IP як бачить браузер напряму (реальний IP студента)
fetch('https://api.ipify.org?format=json').then(function(r){return r.json();}).then(function(d){
  console.log(TAG+' браузер → зовні (реальний IP клієнта):',S,d.ip);
}).catch(function(e){console.warn(TAG+' браузер-тест впав:',S,e.message);});

// 2) IP центрального сервера (прямий вихід, повз ноут-relay)
fetch('/api/_diag/server-ip',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(d){
  console.log(TAG+' центральний сервер → зовні (прямий):',S,d.ip);
}).catch(function(e){console.warn(TAG+' server-ip впав:',S,e.message);});

// 2b) IP через ноут-relay'ї — це IP'и які бачить target для проксованого контенту
fetch('/api/_diag/relay-ip',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(d){
  if(d && Array.isArray(d.relays) && d.relays.length){
    d.relays.forEach(function(r){
      if(r.ip) console.log(TAG+' relay '+r.url+' → '+r.ip,S);
      else console.warn(TAG+' relay '+r.url+' → no IP ('+(r.error||'unknown')+')',S);
    });
  } else {
    console.warn(TAG+' relay-ip відповів без relays:',S,d);
  }
}).catch(function(e){console.warn(TAG+' relay-ip впав (relay не налаштований чи недоступний):',S,e.message);});
})();</script>`;

export const TURNSTILE_STUB_SCRIPT = `<script data-uix-turnstile-stub>(function(){try{
var nextId=0;
var stub={
  render:function(){return 'uix-stub-'+(++nextId);},
  reset:function(){},
  remove:function(){},
  getResponse:function(){return '';},
  execute:function(){},
  isExpired:function(){return false;},
  ready:function(cb){if(typeof cb==='function')setTimeout(cb,0);}
};
try{Object.defineProperty(window,'turnstile',{value:stub,writable:false,configurable:false});}catch(e){window.turnstile=stub;}
}catch(e){}})();</script>`;

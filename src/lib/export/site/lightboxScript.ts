import { MAX_SCALE, MIN_SCALE, ZOOM_STEP } from "@/lib/lightbox";

// Toolbar and nav glyphs, copied from the app's lightbox icon components.
const ICON = {
  close:
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  prev: '<svg width="20" height="20" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 2.5L3.5 5l3 2.5"/></svg>',
  next: '<svg width="20" height="20" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 2.5L6.5 5l-3 2.5"/></svg>',
  zoomOut:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/><path d="M5 7h4"/></svg>',
  zoomIn:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/><path d="M7 5v4M5 7h4"/></svg>',
  fit: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2H2v4M14 6V2h-4M10 14h4v-4M2 10v4h4"/></svg>',
  actual:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5.5L4.5 4.5V11.5"/><path d="M11.5 5.5L13 4.5V11.5"/><circle cx="8" cy="5" r="0.25"/><circle cx="8" cy="11" r="0.25"/></svg>',
};

// Click-to-zoom lightbox for website export pages: a dependency-free port of
// the app's Lightbox component (same classes, so the lightbox rules already in
// the collected style.css style it). Images and inline Mermaid SVGs open in a
// full-viewport overlay with fit / actual size / zoom, prev/next across the
// page, the same keyboard shortcuts, backdrop-click close, and drag-to-pan.
// The image is laid out at natural size x scale inside the scrollable overlay,
// so zooming past the viewport scrolls rather than clips.
export const LIGHTBOX_SCRIPT = `(function(){
var STEP=${ZOOM_STEP},MIN=${MIN_SCALE},MAX=${MAX_SCALE},ICON=${JSON.stringify(ICON)};
document.addEventListener('DOMContentLoaded',function(){
  var items=Array.prototype.slice.call(document.querySelectorAll('.markdown-body img,.markdown-body .mermaid-diagram > svg'));
  if(!items.length)return;
  var overlay,img,level,counter,prev,next,index=0,scale=1,fitted=true,natural={w:1,h:1};
  function clamp(s){return Math.min(MAX,Math.max(MIN,s))}
  function isSvg(el){return el.tagName.toLowerCase()==='svg'}
  function button(cls,label,icon,onClick){var b=document.createElement('button');b.type='button';b.className='lightbox-button '+cls;b.setAttribute('aria-label',label);b.title=label;b.innerHTML=icon;b.addEventListener('click',onClick);return b}
  function build(){
    overlay=document.createElement('div');overlay.className='lightbox-overlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('data-print-hide','true');overlay.tabIndex=-1;
    img=document.createElement('img');img.className='lightbox-image';img.draggable=false;
    img.addEventListener('load',function(){natural=measure(items[index]);img.style.opacity='1';fit()});
    img.addEventListener('error',function(){img.style.opacity='1'});
    prev=button('lightbox-nav lightbox-prev','Previous image (\\u2190)',ICON.prev,function(){go(index-1)});
    next=button('lightbox-nav lightbox-next','Next image (\\u2192)',ICON.next,function(){go(index+1)});
    var bar=document.createElement('div');bar.className='lightbox-toolbar';
    level=document.createElement('span');level.className='lightbox-zoom-level';level.setAttribute('aria-live','polite');
    counter=document.createElement('span');counter.className='lightbox-counter';
    function divider(){var d=document.createElement('span');d.className='lightbox-toolbar-divider';d.setAttribute('aria-hidden','true');return d}
    bar.append(button('','Zoom out (-)',ICON.zoomOut,function(){zoom(1/STEP)}),level,button('','Zoom in (+)',ICON.zoomIn,function(){zoom(STEP)}),divider(),button('','Fit to screen (0)',ICON.fit,fit),button('','Actual size (1)',ICON.actual,function(){scale=1;fitted=false;render()}));
    if(items.length>1)bar.append(divider(),counter);
    overlay.append(button('lightbox-close','Close (Esc)',ICON.close,close),img,bar);
    if(items.length>1){overlay.insertBefore(prev,img);overlay.append(next)}
    overlay.addEventListener('click',function(e){if(e.target===overlay)close()});
    pan(overlay);
  }
  // Mermaid SVGs are sized by their viewBox (as an <img> a width="100%" SVG
  // has no reliable intrinsic size); images by their pixels, falling back to
  // the on-page box for a dimensionless SVG file.
  function measure(el){
    var vb=isSvg(el)&&el.viewBox&&el.viewBox.baseVal;
    if(vb&&vb.width>0&&vb.height>0)return{w:vb.width,h:vb.height};
    if(img.naturalWidth>0&&img.naturalHeight>0)return{w:img.naturalWidth,h:img.naturalHeight};
    var r=el.getBoundingClientRect();return{w:r.width||1,h:r.height||1};
  }
  function fit(){
    var cs=getComputedStyle(overlay);
    var aw=overlay.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
    var ah=overlay.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
    scale=aw>0&&ah>0?clamp(Math.min(aw/natural.w,ah/natural.h)):1;fitted=true;render();
  }
  function zoom(f){scale=clamp(scale*f);fitted=false;render()}
  function render(){
    img.style.width=natural.w*scale+'px';level.textContent=Math.round(scale*100)+'%';
    counter.textContent=(index+1)+' / '+items.length;prev.disabled=index===0;next.disabled=index===items.length-1;
    overlay.toggleAttribute('data-pannable',overlay.scrollWidth>overlay.clientWidth||overlay.scrollHeight>overlay.clientHeight);
  }
  function show(i){
    var el=items[i];index=i;img.style.opacity='0';
    var alt=isSvg(el)?'Diagram':el.getAttribute('alt')||'';
    img.alt=alt;overlay.setAttribute('aria-label',alt?'Image: '+alt:'Image viewer');
    // Exported Mermaid SVGs are light-theme with a transparent background,
    // illegible on the dark backdrop without a light card behind them.
    img.style.background=isSvg(el)?'#fff':'';
    img.src=isSvg(el)?'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(el)):(el.currentSrc||el.src);
    render();
  }
  function go(i){if(i>=0&&i<items.length)show(i)}
  function onKey(e){
    var k=e.key;
    // Leave browser shortcuts (Ctrl/Cmd +/-/0 page zoom, Cmd+1 tabs) alone.
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    if(k==='Escape')close();else if(k==='ArrowLeft')go(index-1);else if(k==='ArrowRight')go(index+1);
    else if(k==='+'||k==='=')zoom(STEP);else if(k==='-')zoom(1/STEP);else if(k==='0')fit();
    else if(k==='1'){scale=1;fitted=false;render()}else return;
    e.preventDefault();
  }
  function onResize(){if(fitted)fit();else render()}
  function open(i){
    if(!overlay)build();
    document.body.appendChild(overlay);document.body.style.overflow='hidden';
    document.addEventListener('keydown',onKey);window.addEventListener('resize',onResize);
    show(i);overlay.focus();
  }
  function close(){
    if(!overlay||!overlay.parentNode)return;
    overlay.remove();document.body.style.overflow='';
    document.removeEventListener('keydown',onKey);window.removeEventListener('resize',onResize);
    var t=triggers[index];(t.closest('a')||t).focus();
  }
  // Drag-to-pan once the zoomed image overflows. Pointer capture starts only
  // after a real drag so plain clicks keep their target (toolbar buttons), and
  // the click trailing a drag is swallowed so it can't read as a backdrop click.
  function pan(el){
    var down=false,moved=false,sx=0,sy=0,sl=0,st=0;
    el.addEventListener('pointerdown',function(e){if(e.button!==0||!el.hasAttribute('data-pannable'))return;down=true;moved=false;sx=e.clientX;sy=e.clientY;sl=el.scrollLeft;st=el.scrollTop});
    el.addEventListener('pointermove',function(e){if(!down)return;var dx=e.clientX-sx,dy=e.clientY-sy;if(!moved&&Math.hypot(dx,dy)>3){moved=true;el.setPointerCapture&&el.setPointerCapture(e.pointerId);el.setAttribute('data-grabbing','')}if(moved){el.scrollLeft=sl-dx;el.scrollTop=st-dy}});
    // Only a pointerup is followed by a click; arming the swallow on pointercancel
    // (a touch drag handed to native scrolling) would eat the next real tap.
    function up(e){if(!down)return;down=false;el.removeAttribute('data-grabbing');if(moved&&e.type==='pointerup')el.addEventListener('click',function(ev){ev.stopPropagation();ev.preventDefault()},{capture:true,once:true})}
    el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);
  }
  // A diagram's click target is its wrapper (matching the app); an image is
  // its own. A linked image zooms instead of navigating and leaves keyboard
  // focus to the link.
  var triggers=items.map(function(el,i){
    var t=el;
    if(isSvg(el)){t=el.parentNode;t.setAttribute('role','button');t.setAttribute('aria-label','Diagram')}else t.setAttribute('data-zoomable','true');
    if(!t.closest('a'))t.tabIndex=0;
    t.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();open(i)});
    t.addEventListener('keydown',function(e){if(e.target===t&&(e.key==='Enter'||e.key===' ')){e.preventDefault();open(i)}});
    return t;
  });
});
})();`;

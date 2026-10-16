/* הצעות חיפוש חכמות — השלמה חיה בשורת החיפוש בדף הבית (מקלדת + קורא מסך, תבנית combobox) */
(function(){
 'use strict';
 let box=null,items=[],active=-1,deb=null;
 function input(){return document.getElementById('q')}
 function close(){
  if(box){box.remove();box=null}
  items=[];active=-1;
  const i=input();if(i){i.setAttribute('aria-expanded','false');i.removeAttribute('aria-activedescendant')}
 }
 function render(list){
  const sb=document.querySelector('.searchbar'),i=input();
  if(!sb||!i)return;
  if(!list.length){close();return}
  if(!box){
   box=document.createElement('ul');
   box.id='search-suggest';box.className='search-suggest';box.setAttribute('role','listbox');
   sb.parentElement.style.position='relative';
   sb.parentElement.appendChild(box);
  }
  items=list;active=-1;
  const TYPE={laundry:'מכבסה',city:'עיר',service:'שירות'};
  box.innerHTML=list.map((s,idx)=>'<li role="option" id="ss-'+idx+'" data-idx="'+idx+'" aria-selected="false"><span>'+esc(s.label)+'</span>'+(s.sub?' <span class="mut">'+esc(s.sub)+'</span>':'')+'<span class="ss-type">'+TYPE[s.type]+'</span></li>').join('');
  i.setAttribute('aria-expanded','true');
 }
 function pick(idx){
  const s=items[idx];if(!s)return;
  close();
  if(s.type==='laundry'&&s.slug)go('#/laundry/'+s.slug);
  else go('#/?q='+encodeURIComponent(s.label));
 }
 function fetchSuggest(v){
  clearTimeout(deb);
  if(!v.trim()){close();return}
  deb=setTimeout(async()=>{
   try{
    const d=await api('/search/suggest?q='+encodeURIComponent(v.trim()));
    render(d.suggestions||[]);
   }catch(e){close()}
  },200);
 }
 document.addEventListener('input',e=>{if(e.target&&e.target.id==='q')fetchSuggest(e.target.value)});
 document.addEventListener('keydown',e=>{
  if(!e.target||e.target.id!=='q'||!box)return;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
   e.preventDefault();
   active=e.key==='ArrowDown'?(active+1)%items.length:(active-1+items.length)%items.length;
   box.querySelectorAll('li').forEach((li,idx)=>{
    li.classList.toggle('active',idx===active);
    li.setAttribute('aria-selected',idx===active?'true':'false');
   });
   e.target.setAttribute('aria-activedescendant','ss-'+active);
  }else if(e.key==='Enter'&&active>=0){e.preventDefault();pick(active)}
  else if(e.key==='Escape'){close()}
 });
 document.addEventListener('click',e=>{
  const li=e.target.closest&&e.target.closest('#search-suggest li');
  if(li){pick(Number(li.dataset.idx));return}
  if(!(e.target.closest&&e.target.closest('.searchbar')))close();
 });
 /* תכונות combobox על שדה החיפוש אחרי כל רינדור */
 const mo=new MutationObserver(()=>{
  const i=input();
  if(i&&i.getAttribute('role')!=='combobox'){
   i.setAttribute('role','combobox');
   i.setAttribute('aria-expanded','false');
   i.setAttribute('aria-controls','search-suggest');
   i.setAttribute('aria-autocomplete','list');
   i.setAttribute('autocomplete','off');
  }
 });
 const app=document.getElementById('app');
 if(app)mo.observe(app,{childList:true,subtree:true});
})();

/* ---- tabs ---- */
function renderTabs(route){
 /* T90+T116: סרגל תחתון מותאם תפקיד, עד 5 פריטים; אורח רואה 'כניסה' קבועה בתחתון */
 let T=[['#/','\u2302','בית']];
 if(!state.token)T.push(['#/login','➜','כניסה']);
 else if(state.courier&&(state.memberships||[]).length)T.push(['#/courier/day','▸','מסלול'],['#/manage','⚙','ניהול'],['#/orders','▤','הזמנות'],['#/account','☺','החשבון שלי']);
 else if(state.courier)T.push(['#/courier','▤','משימות'],['#/courier/day','▸','מסלול'],['#/account','☺','החשבון שלי']);
 else if(state.memberships&&state.memberships.length)T.push(['#/manage','⚙','ניהול'],['#/orders','▤','הזמנות'],['#/community','✦','קהילה'],['#/account','☺','החשבון שלי']);
 else T.push(['#/orders','▤','הזמנות'],['#/club','★','מועדון'],['#/account','☺','החשבון שלי']);
 if(state.me&&state.me.role==='admin'){T.splice(1,0,['#/admin','▣','אדמין']);T=T.slice(0,5)}
 $('#tabs').innerHTML='<div class="in">'+T.map(t=>`<a href="${t[0]}" class="${route===t[0]||(t[0]!=='#/'&&route.startsWith(t[0]))?'on':''}"><span class="ic">${t[1]}</span>${t[2]}</a>`).join('')+'</div>';
}

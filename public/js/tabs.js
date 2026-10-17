/* ---- tabs ---- */
function renderTabs(route){
 const T=[['#/','⌂','בית']];
 if(state.token)T.push(['#/orders','▤','הזמנות'],['#/club','★','מועדון'],['#/account','☺','החשבון שלי']); // T19: כניסה קבועה מכל מסך
 if(state.courier)T.push(['#/courier','▸','שליח']);
 if(state.memberships&&state.memberships.length)T.push(['#/community','✦','קהילה'],['#/manage','⚙','ניהול']);
 if(state.me&&state.me.role==='admin')T.push(['#/admin','▣','אדמין']);
 $('#tabs').innerHTML='<div class="in">'+T.map(t=>`<a href="${t[0]}" class="${route===t[0]||(t[0]!=='#/'&&route.startsWith(t[0]))?'on':''}"><span class="ic">${t[1]}</span>${t[2]}</a>`).join('')+'</div>';
}


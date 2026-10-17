const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('375px notification UI wraps long identifiers and bot bubbles',()=>{
 const bot=fs.readFileSync('public/js/bot-sim.js','utf8');
 const ctx=vm.createContext({onAct(){},state:{token:'demo'},esc:x=>String(x)});
 vm.runInContext(bot,ctx);
 const bubble=vm.runInContext('botSimBubble("me","https://demo.invalid/"+"a".repeat(200))',ctx);
 assert.match(bubble,/overflow-wrap:anywhere/);
 assert.match(bubble,/min-width:0/);
 assert.match(vm.runInContext('vBotSim()',ctx),/flex-wrap:wrap/);
 const msgs=fs.readFileSync('public/js/messages.js','utf8');
 assert.match(msgs,/flex:1;min-width:0;overflow-wrap:anywhere/);
 assert.match(msgs,/flex-shrink:0/);
});
